const { app, BrowserWindow, BrowserView, ipcMain, Menu, shell, session, dialog } = require('electron');
const path = require('path');
// @electron/remote kaldırıldı

// Event listener sınırını artır
require('events').EventEmitter.defaultMaxListeners = 20;

let mainWindow;
let views = new Map(); // Tüm sekmelerin view'larını sakla
let activeViewId = null; // Aktif sekmenin ID'si
let isDev = process.env.NODE_ENV === 'development';
let nextViewId = 1; // Yeni sekmeler için ID üreteci

// Toolbar height constants
const TAB_HEIGHT = 35;  // Tab yüksekliğini azalttık
const NAV_HEIGHT = 45;  // Navigation bar yüksekliğini azalttık
const PADDING = 10;     // Padding'i azalttık
const TOTAL_TOOLBAR_HEIGHT = TAB_HEIGHT + NAV_HEIGHT + PADDING;

// View sınırlarını güncelle
function updateViewBounds() {
  if (!mainWindow || !activeViewId || !views.has(activeViewId)) return;
  
  const bounds = mainWindow.getBounds();
  const view = views.get(activeViewId);
  
  // Toolbar'ın altında başlayacak şekilde konumlandır
  const toolbarOffset = TOTAL_TOOLBAR_HEIGHT + 15; // Daha fazla boşluk bırak
  
  // BrowserView'ı toolbar'ın hemen altına yerleştir
  const extraMargin = 2; // Minimal boşluk
  view.setBounds({ 
    x: 0, 
    y: toolbarOffset + extraMargin,
    width: bounds.width,
    height: Math.max(0, bounds.height - toolbarOffset - extraMargin)
  });
  
  // BrowserView'ın arka planını ayarla
  view.setBackgroundColor('#ffffff');
}

// Ayarlar ve yer imleri için veri saklama
let settings = {
  homeUrl: 'https://www.google.com',
  defaultZoom: 1.0,
  jsEnabled: true,
  darkMode: false,
  fontSize: 14,
  startupOption: 'homepage',
  blockPopups: true,
  cookieSettings: 'allow',
  downloadPath: app.getPath('downloads'),
  askDownloadLocation: false
};

let bookmarks = [];

function createWindow() {
  // Ana tarayıcı penceresini oluştur
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.js')
    },
    frame: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#ffffff',
    show: false,
    transparent: false,
    icon: process.platform === 'linux' ? path.join(__dirname, 'assets/icon.png') : undefined
  });

  // Pencere yeniden boyutlandırmayı işle
  mainWindow.on('resize', updateViewBounds);
  
  // İlk yüklemede bekle
  mainWindow.webContents.once('dom-ready', () => {
    // İlk sekmeyi oluştur
    const firstViewId = createTab(settings.homeUrl);
    switchTab(firstViewId);
  });
  mainWindow.on('maximize', updateViewBounds);
  mainWindow.on('unmaximize', updateViewBounds);

  // Pencere göstermeye hazır olduğunda
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    
    // Daha iyi kullanıcı deneyimi için aktif görünüme odaklan
    if (activeViewId && views.has(activeViewId)) {
      views.get(activeViewId).webContents.focus();
    }
  });

  // index.html dosyasını yükle
  mainWindow.loadFile('index.html');

  // Geliştirme modunda DevTools'u aç
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  // Uygulama menüsünü oluştur
  createMenu();
}

// Ayarlar penceresini oluştur
function createSettingsWindow() {
  const settingsWindow = new BrowserWindow({
    width: 800,
    height: 600,
    parent: mainWindow,
    modal: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  settingsWindow.loadFile('settings.html');
  
  if (isDev) {
    settingsWindow.webContents.openDevTools();
  }

  return settingsWindow;
}

// IPC işleyicileri
ipcMain.handle('get-zoom-factor', () => {
  if (activeViewId && views.has(activeViewId)) {
    return views.get(activeViewId).webContents.getZoomFactor();
  }
  return 1.0;
});

ipcMain.handle('set-zoom-factor', (event, factor) => {
  if (activeViewId && views.has(activeViewId)) {
    views.get(activeViewId).webContents.setZoomFactor(factor);
    return true;
  }
  return false;
});

ipcMain.handle('zoom-in', () => {
  if (activeViewId && views.has(activeViewId)) {
    const view = views.get(activeViewId);
    const currentZoom = view.webContents.getZoomFactor();
    const newZoom = Math.min(3.0, currentZoom + 0.1);
    view.webContents.setZoomFactor(newZoom);
    mainWindow.webContents.send('zoom-change', newZoom);
    return newZoom;
  }
  return 1.0;
});

ipcMain.handle('zoom-out', () => {
  if (activeViewId && views.has(activeViewId)) {
    const view = views.get(activeViewId);
    const currentZoom = view.webContents.getZoomFactor();
    const newZoom = Math.max(0.3, currentZoom - 0.1);
    view.webContents.setZoomFactor(newZoom);
    mainWindow.webContents.send('zoom-change', newZoom);
    return newZoom;
  }
  return 1.0;
});

ipcMain.handle('reset-zoom', () => {
  if (activeViewId && views.has(activeViewId)) {
    const view = views.get(activeViewId);
    view.webContents.setZoomFactor(1.0);
    mainWindow.webContents.send('zoom-change', 1.0);
    return 1.0;
  }
  return 1.0;
});

ipcMain.handle('navigate-to', (event, url) => {
  if (activeViewId && views.has(activeViewId)) {
    // Protokol yoksa ekle
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    views.get(activeViewId).webContents.loadURL(url);
    return true;
  }
  return false;
});

ipcMain.handle('go-back', () => {
  if (activeViewId && views.has(activeViewId)) {
    const view = views.get(activeViewId);
    if (view.webContents.navigationHistory.canGoBack()) {
      view.webContents.navigationHistory.goBack();
      return true;
    }
  }
  return false;
});

ipcMain.handle('go-forward', () => {
  if (activeViewId && views.has(activeViewId)) {
    const view = views.get(activeViewId);
    if (view.webContents.navigationHistory.canGoForward()) {
      view.webContents.navigationHistory.goForward();
      return true;
    }
  }
  return false;
});

ipcMain.handle('refresh', () => {
  if (activeViewId && views.has(activeViewId)) {
    views.get(activeViewId).webContents.reload();
    return true;
  }
  return false;
});

ipcMain.handle('go-home', () => {
  if (activeViewId && views.has(activeViewId)) {
    views.get(activeViewId).webContents.loadURL(settings.homeUrl);
    return true;
  }
  return false;
});

ipcMain.handle('get-current-url', () => {
  if (activeViewId && views.has(activeViewId)) {
    return views.get(activeViewId).webContents.getURL();
  }
  return '';
});

ipcMain.handle('get-current-title', () => {
  if (activeViewId && views.has(activeViewId)) {
    return views.get(activeViewId).webContents.getTitle();
  }
  return 'Modern Browser';
});

// Ayarlar yönetimi
ipcMain.handle('get-settings', () => {
  return settings;
});

ipcMain.handle('save-settings', (event, newSettings) => {
  // Eski ayarları sakla
  const oldSettings = { ...settings };
  
  // Yeni ayarları uygula
  settings = { ...settings, ...newSettings };
  
  // Zoom ayarlarını uygula
  if (settings.defaultZoom !== oldSettings.defaultZoom) {
    views.forEach(view => {
      view.webContents.setZoomFactor(settings.defaultZoom);
    });
  }
  
  // JavaScript ayarlarını uygula
  if (settings.jsEnabled !== oldSettings.jsEnabled) {
    views.forEach(view => {
      view.webContents.setJavaScriptEnabled(settings.jsEnabled);
    });
  }

  // Pop-up engelleme ayarlarını uygula
  if (settings.blockPopups !== oldSettings.blockPopups) {
    views.forEach(view => {
      view.webContents.setWindowOpenHandler(({ url }) => {
        return settings.blockPopups ? { action: 'deny' } : { action: 'allow' };
      });
    });
  }

  // Tüm pencerelere ayar güncellemesini bildir
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send('settings-update', settings);
  });
  
  return true;
});

ipcMain.handle('reset-settings', () => {
  settings = {
    homeUrl: 'https://www.google.com',
    defaultZoom: 1.0,
    jsEnabled: true,
    darkMode: false,
    fontSize: 14,
    startupOption: 'homepage',
    blockPopups: true,
    cookieSettings: 'allow',
    downloadPath: app.getPath('downloads'),
    askDownloadLocation: false
  };
  
  // Tüm pencerelere ayar güncellemesini bildir
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send('settings-update', settings);
  });
  
  return settings;
});

// Yer imleri yönetimi
ipcMain.handle('get-bookmarks', () => {
  return bookmarks;
});

ipcMain.handle('add-bookmark', (event, bookmark) => {
  const existingIndex = bookmarks.findIndex(b => b.url === bookmark.url);
  if (existingIndex >= 0) {
    bookmarks[existingIndex] = bookmark;
  } else {
    bookmarks.push(bookmark);
  }
  return true;
});

ipcMain.handle('remove-bookmark', (event, url) => {
  bookmarks = bookmarks.filter(b => b.url !== url);
  return true;
});

ipcMain.handle('is-bookmarked', (event, url) => {
  return bookmarks.some(b => b.url === url);
});

// Sistem bilgileri
ipcMain.handle('get-browser-version', () => {
  return app.getVersion();
});

ipcMain.handle('get-user-agent', () => {
  return view ? view.webContents.getUserAgent() : navigator.userAgent;
});

ipcMain.handle('clear-browsing-data', () => {
  if (view) {
    view.webContents.session.clearStorageData();
    view.webContents.session.clearCache();
    return true;
  }
  return false;
});

ipcMain.handle('get-download-path', () => {
  return settings.downloadPath;
});

ipcMain.handle('set-download-path', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    settings.downloadPath = result.filePaths[0];
    return settings.downloadPath;
  }
  
  return settings.downloadPath;
});

// Tema yönetimi
ipcMain.handle('toggle-dark-mode', (event, enabled) => {
  settings.darkMode = enabled;
  return settings.darkMode;
});

ipcMain.handle('is-dark-mode', () => {
  return settings.darkMode;
});

// Ayarlar penceresini aç
ipcMain.handle('open-settings', () => {
  createSettingsWindow();
  return true;
});

// Pencereyi kapat
ipcMain.handle('close-window', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    win.close();
    return true;
  }
  return false;
});

// Sekme yönetimi için IPC işleyicileri
ipcMain.handle('new-tab', (event, url) => {
  const viewId = createTab(url);
  switchTab(viewId);
  return viewId;
});

ipcMain.handle('switch-tab', (event, viewId) => {
  switchTab(viewId);
  return true;
});

ipcMain.handle('close-tab', (event, viewId) => {
  closeTab(viewId);
  return true;
});

ipcMain.handle('get-tabs', () => {
  const tabs = [];
  for (const [id, view] of views) {
    tabs.push({
      id,
      url: view.webContents.getURL(),
      title: view.webContents.getTitle(),
      active: id === activeViewId
    });
  }
  return tabs;
});

// URL güncellemesi için event gönder
function updateUrlInView(url) {
  if (mainWindow && url) {
    mainWindow.webContents.send('url-update', url);
    updateWindowTitle(url);
  }
}

// Yeni sekme oluşturma fonksiyonu
function createTab(url = 'https://www.google.com') {
  const viewId = nextViewId++;
  const view = new BrowserView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      sandbox: true
    }
  });
  
  // BrowserView'ı düzgün konumlandır
  view.setBackgroundColor('#ffffff');
  view.setAutoResize({ width: true, height: true });
  
  // View'ı sakla
  views.set(viewId, view);

  // Olayları ayarla
  setupViewEvents(view, viewId);

  // URL'i yükle
  view.webContents.loadURL(url);

  return viewId;
}

// View olaylarını ayarla
function setupViewEvents(view, viewId) {
  view.webContents.on('did-navigate', (event, url) => {
    updateUrlInView(url);
    mainWindow.webContents.send('tab-update', { 
      id: viewId, 
      url, 
      title: view.webContents.getTitle(), 
      active: viewId === activeViewId 
    });
  });

  view.webContents.on('did-navigate-in-page', (event, url) => {
    updateUrlInView(url);
    mainWindow.webContents.send('tab-update', { 
      id: viewId, 
      url, 
      title: view.webContents.getTitle(), 
      active: viewId === activeViewId 
    });
  });

  view.webContents.on('page-title-updated', (event, title) => {
    mainWindow.webContents.send('tab-update', { 
      id: viewId, 
      url: view.webContents.getURL(), 
      title, 
      active: viewId === activeViewId 
    });
  });

  view.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    if (errorCode !== -3) {
      view.webContents.loadFile('error.html', {
        query: {
          errorCode: errorCode,
          errorDescription: errorDescription,
          url: validatedURL
        }
      });
    }
  });

  view.webContents.setWindowOpenHandler(({ url }) => {
    createTab(url);
    return { action: 'deny' };
  });
}

// Sekme değiştirme fonksiyonu
function switchTab(viewId) {
  if (!views.has(viewId)) return;

  // Mevcut sekmeyi gizle
  if (activeViewId && views.has(activeViewId)) {
    const oldView = views.get(activeViewId);
    mainWindow.removeBrowserView(oldView);
  }

  // Yeni sekmeyi göster
  const newView = views.get(viewId);
  mainWindow.addBrowserView(newView);
  activeViewId = viewId;

  // View sınırlarını güncelle
  updateViewBounds();

  // URL ve başlığı güncelle
  const url = newView.webContents.getURL();
  const title = newView.webContents.getTitle();
  mainWindow.webContents.send('tab-update', { id: viewId, url, title, active: true });
  updateWindowTitle(url);
  
  // URL güncellemesini gerçek zamanlı olarak gönder
  mainWindow.webContents.send('url-update', url);
}

// Sekme kapatma fonksiyonu
function closeTab(viewId) {
  if (!views.has(viewId)) return;

  const view = views.get(viewId);
  
  // Eğer aktif sekme kapatılıyorsa, başka bir sekmeye geç
  if (viewId === activeViewId) {
    const viewIds = Array.from(views.keys());
    const currentIndex = viewIds.indexOf(viewId);
    const newIndex = currentIndex > 0 ? currentIndex - 1 : currentIndex + 1;
    
    if (viewIds[newIndex]) {
      switchTab(viewIds[newIndex]);
    }
  }

  // View'ı temizle ve kaldır
  mainWindow.removeBrowserView(view);
  views.delete(viewId);

  // Eğer son sekme kapatıldıysa, yeni bir sekme aç
  if (views.size === 0) {
    const newViewId = createTab();
    switchTab(newViewId);
  }

  // UI'ı güncelle
  mainWindow.webContents.send('tab-closed', viewId);
}

function updateWindowTitle(url) {
  if (!mainWindow) return;
  
  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname;
    mainWindow.setTitle(`Modern Browser - ${domain}`);
  } catch (error) {
    mainWindow.setTitle('Modern Browser');
  }
}

function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Tab',
          accelerator: 'CmdOrCtrl+T',
          click: () => {
            // Yeni sekme oluştur
            const newTabId = createTab();
            switchTab(newTabId);
          }
        },
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            createWindow();
          }
        },
        { type: 'separator' },
        {
          label: 'Close',
          accelerator: process.platform === 'darwin' ? 'Cmd+W' : 'Ctrl+W',
          click: () => {
            if (mainWindow) {
              mainWindow.close();
            }
          }
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectall' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Navigation',
      submenu: [
        {
          label: 'Back',
          accelerator: 'Alt+Left',
          click: () => {
            if (activeViewId && views.has(activeViewId)) {
              const view = views.get(activeViewId);
              if (view.webContents.navigationHistory.canGoBack()) {
                view.webContents.navigationHistory.goBack();
              }
            }
          }
        },
        {
          label: 'Forward',
          accelerator: 'Alt+Right',
          click: () => {
            if (activeViewId && views.has(activeViewId)) {
              const view = views.get(activeViewId);
              if (view.webContents.navigationHistory.canGoForward()) {
                view.webContents.navigationHistory.goForward();
              }
            }
          }
        },
        {
          label: 'Refresh',
          accelerator: 'F5',
          click: () => {
            if (activeViewId && views.has(activeViewId)) {
              views.get(activeViewId).webContents.reload();
            }
          }
        },
        {
          label: 'Home',
          accelerator: 'Alt+Home',
          click: () => {
            if (activeViewId && views.has(activeViewId)) {
              views.get(activeViewId).webContents.loadURL(settings.homeUrl);
            }
          }
        }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' }
      ]
    }
  ];

  // macOS specific menu adjustments
  if (process.platform === 'darwin') {
    template.unshift({
      label: app.getName(),
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideothers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    });

    // Window menu
    template[5].submenu = [
      { role: 'close' },
      { role: 'minimize' },
      { role: 'zoom' },
      { type: 'separator' },
      { role: 'front' }
    ];
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// App event handlers
app.whenReady().then(() => {
  createWindow();
  
  // Handle app activation (macOS)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Security: Prevent new window creation
app.on('web-contents-created', (event, contents) => {
  contents.on('new-window', (event, navigationUrl) => {
    // Prevent new window creation and open in default browser instead
    event.preventDefault();
    shell.openExternal(navigationUrl);
  });
});

// Handle certificate errors
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  if (isDev) {
    // In development, ignore certificate errors
    event.preventDefault();
    callback(true);
  } else {
    // In production, use default behavior
    callback(false);
  }
});

// Prevent navigation to external protocols
app.on('web-contents-created', (event, contents) => {
  contents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    
    if (parsedUrl.origin !== 'https://www.google.com' && !navigationUrl.startsWith('https://')) {
      console.log('Blocked navigation to:', navigationUrl);
      event.preventDefault(); // Güvenli olmayan URL'lere navigasyonu engelle
    }
  });
});

// Graceful shutdown
app.on('before-quit', () => {
  // Cleanup operations before quitting
  console.log('Application is quitting...');
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  
  // Log error details
  const errorDetails = {
    message: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString()
  };
  
  // Show error dialog to user
  if (mainWindow) {
    dialog.showErrorBox(
      'An error occurred',
      `The application encountered an unexpected error.\n\nError: ${error.message}\n\nThe application will continue running, but some features may not work correctly.`
    );
  }
  
  // You could also save error logs to a file here
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  
  // Log rejection details
  const rejectionDetails = {
    reason: reason ? (reason.stack || reason.message || String(reason)) : 'Unknown reason',
    timestamp: new Date().toISOString()
  };
  
  // You could also save rejection logs to a file here
});