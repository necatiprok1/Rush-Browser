const {
  app,
  BrowserWindow,
  BrowserView,
  ipcMain,
  Menu,
  shell,
  session,
  dialog,
  clipboard,
  nativeImage,
  net,
} = require("electron");
const path = require("path");
const fs = require("fs");
const keytar = require("keytar");
// ESM ve CommonJS uyumlu import
let Store;
try {
  Store = require("electron-store").default;
} catch {
  Store = require("electron-store");
}
const store = new Store({
  name: "browser-settings",
  defaults: {
    theme: "dark",
    "user-info": null,
  },
});

// Event listener sınırını artır
require("events").EventEmitter.defaultMaxListeners = 20;

let mainWindow;
let overlayWindow; // Floating search overlay window
let views = new Map(); // Tüm sekmelerin view'larını sakla
let activeViewId = null; // Aktif sekmenin ID'si
let isDev = process.env.NODE_ENV === "development";
let nextViewId = 1; // Yeni sekmeler için ID üreteci

// Toolbar height constants
const TAB_HEIGHT = 35; // Tab yüksekliğini azalttık
const NAV_HEIGHT = 45; // Navigation bar yüksekliğini azalttık
const PADDING = 10; // Padding'i azalttık
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
    height: Math.max(0, bounds.height - toolbarOffset - extraMargin),
  });

  // BrowserView'ın arka planını ayarla
  view.setBackgroundColor("#ffffff");
}

// Helper function to format file sizes
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

// Ayarları yükle ve varsayılan değerleri ayarla
let settings = {
  homeUrl: "file://" + path.join(__dirname, "search.html"),
  homepage: "newtab", // 'newtab', 'custom', or 'lastsession'
  customUrl: "", // Custom homepage URL
  searchEngine: "google", // Default search engine
  clearOnExit: false, // Clear data on exit setting
  quickSearch: store.get("quickSearch", false), // Load Quick Search setting from storage
  defaultZoom: 1.0,
  jsEnabled: true,
  darkMode: store.get("darkMode", true), // Load from storage, default to dark mode
  fontSize: store.get("fontSize", "medium"), // Load font size from storage
  startupOption: "homepage",
  blockPopups: true,
  cookieSettings: "allow",
  downloadPath: app.getPath("downloads"),
  askDownloadLocation: true,
};

// Arama motorları tanımları
const searchEngines = {
  google: {
    name: "Google",
    searchUrl: "https://www.google.com/search?q=",
    suggestUrl: "https://suggestqueries.google.com/complete/search?client=chrome&q="
  },
  bing: {
    name: "Bing", 
    searchUrl: "https://www.bing.com/search?q=",
    suggestUrl: "https://api.bing.microsoft.com/qsonhs.aspx?type=cb&q="
  },
  duckduckgo: {
    name: "DuckDuckGo",
    searchUrl: "https://duckduckgo.com/?q=",
    suggestUrl: "https://duckduckgo.com/ac/?q="
  },
  yahoo: {
    name: "Yahoo",
    searchUrl: "https://search.yahoo.com/search?p=",
    suggestUrl: "https://search.yahoo.com/sugg/chrome?output=fxjson&command="
  }
};

// Sekme oturumlarını yönetme
let sessionTabs = [];

// Sekme oturumunu kaydet
function saveSession() {
  try {
    const currentSession = [];
    views.forEach((view, viewId) => {
      const url = view.webContents.getURL();
      const title = view.webContents.getTitle();
      currentSession.push({
        viewId: viewId,
        url: url,
        title: title || "New Tab",
        isActive: viewId === activeViewId
      });
    });
    
    store.set("lastSession", currentSession);
    console.log("Session saved:", currentSession);
  } catch (error) {
    console.log("Error saving session:", error);
  }
}

// Sekme oturumunu yükle
function loadSession() {
  try {
    const lastSession = store.get("lastSession", []);
    console.log("Loading session:", lastSession);
    
    if (lastSession.length > 0) {
      let activeTabId = null;
      
      // Her kayıtlı sekme için yeni sekme oluştur
      lastSession.forEach((tab, index) => {
        if (tab.url && tab.url !== "about:blank") {
          const newTabId = createTab(tab.url);
          if (tab.isActive || index === 0) {
            activeTabId = newTabId;
          }
        }
      });
      
      // Aktif sekmeyi ayarla
      if (activeTabId) {
        switchTab(activeTabId);
      }
      
      return true;
    }
    return false;
  } catch (error) {
    console.log("Error loading session:", error);
    return false;
  }
}

// Çıkışta veri temizleme fonksiyonu
function clearDataOnExit() {
  try {
    console.log("Clearing all data on exit...");
    
    // 1. Electron store'daki verileri temizle (clearOnExit ayarını koru)
    const preserveClearOnExit = store.get("clearOnExit", false);
    const defaultDarkMode = store.get("darkMode", true); // Mevcut tema ayarını da koru
    
    // Store'u tamamen temizle
    store.clear();
    
    // Korunacak ayarları geri yükle
    store.set("darkMode", defaultDarkMode);
    store.set("homepage", "newtab");
    store.set("searchEngine", "google");
    store.set("clearOnExit", preserveClearOnExit); // Bu ayarı koru!
    
    // 2. Browser session data'yı temizle
    if (session.defaultSession) {
      // Cookies temizle
      session.defaultSession.clearStorageData({
        storages: ['cookies', 'localStorage', 'sessionStorage', 'indexdb', 'websql', 'cachestorage']
      }).catch(err => {
        console.log("Error clearing storage data:", err);
      });
      
      // Cache temizle
      session.defaultSession.clearCache().catch(err => {
        console.log("Error clearing cache:", err);
      });
    }
    
    // 3. Arama geçmişini ve diğer browser data'yı temizle
    // Bu MainWindow'daki search.html sayfasına JavaScript inject ederek yapılacak
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        mainWindow.webContents.executeJavaScript(`
          try {
            // Clear search data using global function
            if (typeof window.clearSearchData === 'function') {
              window.clearSearchData();
            }
            
            // Clear all localStorage data
            localStorage.clear();
            
            // Clear all sessionStorage data
            sessionStorage.clear();
            
            console.log('Browser data cleared on exit');
            true; // Return success
          } catch (e) {
            console.log('Error clearing browser data:', e);
            false; // Return failure
          }
        `).then(result => {
          console.log('Browser data cleanup result:', result);
        }).catch(err => {
          console.log("Error executing cleanup script:", err);
        });
      } catch (error) {
        console.log("Error injecting cleanup script:", error);
      }
    }
    
    // 4. Settings'i varsayılana döndür (clearOnExit hariç)
    settings = {
      homeUrl: "file://" + path.join(__dirname, "search.html"),
      homepage: "newtab",
      customUrl: "",
      searchEngine: "google",
      clearOnExit: preserveClearOnExit, // Bu ayarı koru!
      defaultZoom: 1.0,
      jsEnabled: true,
      darkMode: defaultDarkMode,
      fontSize: 14,
      startupOption: "homepage",
      blockPopups: true,
      cookieSettings: "allow",
      downloadPath: app.getPath("downloads"),
      askDownloadLocation: true,
    };
    
    console.log("Data clearing completed successfully");
    
  } catch (error) {
    console.error("Error during data clearing:", error);
  }
}

// Kayıtlı ayarları yükle
function loadStoredSettings() {
  try {
    const storedHomepage = store.get("homepage", "newtab");
    const storedCustomUrl = store.get("customUrl", "");
    const storedDarkMode = store.get("darkMode", true);
    const storedSearchEngine = store.get("searchEngine", "google");
    const storedClearOnExit = store.get("clearOnExit", false);
    const storedFontSize = store.get("fontSize", "medium");

    settings.homepage = storedHomepage;
    settings.customUrl = storedCustomUrl;
    settings.darkMode = storedDarkMode;
    settings.searchEngine = storedSearchEngine;
    settings.clearOnExit = storedClearOnExit;
    settings.fontSize = storedFontSize;

    // Homepage URL'sini ayarla
    if (settings.homepage === "custom" && settings.customUrl) {
      try {
        new URL(settings.customUrl);
        settings.homeUrl = settings.customUrl;
      } catch (e) {
        console.log("Invalid stored custom URL, using default");
        settings.homeUrl = "file://" + path.join(__dirname, "search.html");
      }
    } else {
      settings.homeUrl = "file://" + path.join(__dirname, "search.html");
    }

    console.log("Settings loaded:", settings);
  } catch (error) {
    console.log("Error loading stored settings:", error);
  }
}

let bookmarks = [];

// Downloads tracking
let downloads = []; // Array to store download information
let nextDownloadId = 1;

// Create overlay window for floating UI elements
function createOverlayWindow() {
  overlayWindow = new BrowserWindow({
    parent: mainWindow,
    modal: false,
    show: false,
    width: 800,
    height: 600,
    transparent: true,
    frame: false,
    resizable: false,
    focusable: true,
    alwaysOnTop: true,
    fullscreenable: false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, "preload.js"),
    }
  });

  overlayWindow.loadFile("overlay.html");

  // Center overlay on main window
  function centerOverlayOnMain() {
    if (mainWindow && overlayWindow) {
      const mainBounds = mainWindow.getBounds();
      const overlayBounds = overlayWindow.getBounds();
      
      overlayWindow.setBounds({
        x: mainBounds.x + (mainBounds.width - overlayBounds.width) / 2,
        y: mainBounds.y + (mainBounds.height - overlayBounds.height) / 2,
        width: overlayBounds.width,
        height: overlayBounds.height
      });
    }
  }

  // Handle overlay window events
  overlayWindow.on('blur', () => {
    // Hide overlay when it loses focus (unless clicking within overlay)
    setTimeout(() => {
      if (overlayWindow && overlayWindow.isVisible()) {
        overlayWindow.hide();
      }
    }, 100);
  });

  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });

  // Sync overlay position when main window moves
  if (mainWindow) {
    mainWindow.on('moved', centerOverlayOnMain);
    mainWindow.on('resized', centerOverlayOnMain);
    mainWindow.on('restore', centerOverlayOnMain);
    mainWindow.on('maximize', centerOverlayOnMain);
    mainWindow.on('unmaximize', centerOverlayOnMain);
  }

  // Hide overlay when main window is hidden/minimized
  if (mainWindow) {
    mainWindow.on('hide', () => {
      if (overlayWindow) overlayWindow.hide();
    });
    
    mainWindow.on('minimize', () => {
      if (overlayWindow) overlayWindow.hide();
    });
  }
}

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
      preload: path.join(__dirname, "preload.js"),
    },
    // Başlangıç temasını ayarla
    backgroundColor: settings.darkMode ? "#0a0a0f" : "#ffffff",
    frame: true,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    backgroundColor: "#ffffff",
    show: false,
    transparent: false,
    icon:
      process.platform === "linux"
        ? path.join(__dirname, "assets/icon.png")
        : undefined,
  });
  mainWindow.menuBarVisible = false;

  // Global download handler - Set up once for all downloads
  const globalDownloadHandler = (event, item, webContents) => {
    try {
      // Generate unique download ID
      const downloadId = nextDownloadId++;
      
      // Initial download state
      const download = {
        id: downloadId,
        filename: item.getFilename(),
        filepath: "",
        url: item.getURL(),
        mime: item.getMimeType(),
        receivedBytes: 0,
        totalBytes: item.getTotalBytes() || 0, // Handle cases where total size is unknown
        status: "started",
        startTime: new Date(),
        speed: 0,
        progress: 0,
        retryCount: 0,
        maxRetries: 3,
        error: null
      };

      console.log(`[Download ${downloadId}] Starting download:`, {
        filename: download.filename,
        url: download.url,
        totalBytes: download.totalBytes
      });

      // Add to downloads array
      downloads.push(download);

      // Automatically open/focus downloads tab when download starts
      openOrFocusDownloadsTab();

      // Handle save path
      const savePath = path.join(settings.downloadPath, item.getFilename());
      item.setSavePath(savePath);

      // Set a reasonable chunk size (5MB)
      const CHUNK_SIZE = 5 * 1024 * 1024;
      
      // Set timeout (30 seconds per chunk)
      const CHUNK_TIMEOUT = 30000;

      // Track chunk download progress
      let lastProgressUpdate = Date.now();
      let lastReceivedBytes = 0;
      let isStalled = false;

      item.on('updated', (event, state) => {
        try {
          const currentTime = Date.now();
          const timeDiff = (currentTime - lastProgressUpdate) / 1000; // Convert to seconds
          const bytesDiff = item.getReceivedBytes() - lastReceivedBytes;
          
          // Calculate current download speed (bytes per second)
          const currentSpeed = timeDiff > 0 ? bytesDiff / timeDiff : 0;

          // Update download info
          download.status = state === 'progressing' ? 'progress' : state; // Normalize status
          download.receivedBytes = item.getReceivedBytes();
          download.totalBytes = item.getTotalBytes() || download.totalBytes;
          
          // Calculate progress
          if (download.totalBytes > 0) {
            download.progress = (download.receivedBytes / download.totalBytes) * 100;
          } else {
            // Unknown total size - just show that we're downloading
            download.progress = 0;
          }
          
          download.speed = currentSpeed;
          download.filepath = item.getSavePath();

          console.log(`[Download ${downloadId}] Progress:`, {
            progress: download.totalBytes > 0 ? Math.round(download.progress) + '%' : 'Unknown size',
            speed: `${Math.round(currentSpeed / 1024)} KB/s`,
            state: state,
            normalizedStatus: download.status,
            receivedBytes: download.receivedBytes,
            totalBytes: download.totalBytes
          });

          // Check for stalled download
          if (timeDiff > CHUNK_TIMEOUT / 1000 && bytesDiff === 0 && !isStalled) {
            isStalled = true;
            console.log(`[Download ${downloadId}] Download appears stalled`);
            
            // Download appears stalled, try to resume
            if (download.retryCount < download.maxRetries) {
              download.retryCount++;
              download.status = 'retrying';
              console.log(`[Download ${downloadId}] Attempting retry ${download.retryCount}/${download.maxRetries}`);
              
              // Pause and resume to try to unstick the download
              item.pause();
              setTimeout(() => {
                if (item.canResume()) {
                  isStalled = false;
                  item.resume();
                  console.log(`[Download ${downloadId}] Resumed download`);
                } else {
                  download.status = 'failed';
                  download.error = 'Cannot resume download';
                  console.error(`[Download ${downloadId}] Cannot resume download`);
                }
              }, 1000);
            } else {
              item.cancel();
              download.status = 'failed';
              download.error = 'Download stalled and max retries exceeded';
              console.error(`[Download ${downloadId}] Failed: ${download.error}`);
            }
          }

          // Reset stalled state if we're making progress
          if (bytesDiff > 0) {
            isStalled = false;
          }

          // Update tracking variables
          lastProgressUpdate = currentTime;
          lastReceivedBytes = item.getReceivedBytes();

          // Notify renderer about progress with detailed logging
          console.log(`🔄 Sending download update for ${download.filename}:`, {
            id: download.id,
            progress: download.progress,
            status: download.status,
            receivedBytes: download.receivedBytes,
            totalBytes: download.totalBytes
          });
          
          mainWindow.webContents.send('download-update', downloads);
        } catch (error) {
          console.error(`[Download ${downloadId}] Error in updated event:`, error);
        }
      });

      item.on('done', (event, state) => {
        try {
          console.log(`[Download ${downloadId}] Download finished with state:`, state);
          
          if (state === 'completed') {
            download.status = 'completed';
            download.progress = 100;
            download.completedTime = new Date();
            
            // Verify file integrity
            try {
              const stats = fs.statSync(download.filepath);
              if (stats.size !== download.totalBytes && download.totalBytes > 0) {
                download.status = 'failed';
                download.error = 'File size mismatch';
                console.error(`[Download ${downloadId}] File size mismatch:`, {
                  expected: download.totalBytes,
                  actual: stats.size
                });
              } else {
                console.log(`[Download ${downloadId}] Successfully completed:`, {
                  filepath: download.filepath,
                  size: stats.size
                });
                
                // Show completion notification in main window
                mainWindow.webContents.send('download-completed', {
                  filename: download.filename,
                  filePath: download.filepath,
                  id: downloadId
                });
              }
            } catch (error) {
              download.status = 'failed';
              download.error = `File verification failed: ${error.message}`;
              console.error(`[Download ${downloadId}] File verification error:`, error);
            }
          } else {
            download.status = 'failed';
            download.error = state;
            console.error(`[Download ${downloadId}] Failed with state:`, state);
            
            // Show failure notification in main window
            mainWindow.webContents.send('download-failed', {
              filename: download.filename,
              error: download.error,
              id: downloadId
            });
          }

          // Notify renderer about completion
          mainWindow.webContents.send('download-update', downloads);
        } catch (error) {
          console.error(`[Download ${downloadId}] Error in done event:`, error);
        }
      });

      // Handle errors
      item.on('error', (error) => {
        try {
          download.status = 'failed';
          download.error = error.message;
          console.error(`[Download ${downloadId}] Download error:`, error);
          mainWindow.webContents.send('download-update', downloads);
        } catch (err) {
          console.error(`[Download ${downloadId}] Error in error event:`, err);
        }
      });
    } catch (error) {
      console.error('Critical error in download handler:', error);
    }
  };

  // Set up global download handler for default session
  session.defaultSession.removeAllListeners('will-download');
  session.defaultSession.on('will-download', globalDownloadHandler);

  // Pencere yeniden boyutlandırmayı işle
  mainWindow.on("resize", updateViewBounds);

  // Pencere kapanırken oturumu kaydet veya verileri temizle
  mainWindow.on("close", (event) => {
    // Clean up overlay window before closing
    if (overlayWindow) {
      overlayWindow.destroy();
      overlayWindow = null;
    }
    
    if (settings.clearOnExit) {
      console.log("Window closing with clear on exit enabled, clearing all data...");
      clearDataOnExit();
    } else if (settings.homepage === "lastsession") {
      saveSession();
    }
  });

  // İlk yüklemede bekle
  mainWindow.webContents.once("dom-ready", () => {
    // Homepage ayarına göre başlangıç davranışını belirle
    if (settings.homepage === "lastsession") {
      // Son oturumu yüklemeye çalış
      const sessionLoaded = loadSession();
      
      if (!sessionLoaded) {
        // Eğer oturum yüklenemezse varsayılan sekmeyi aç
        const firstViewId = createTab("file://" + path.join(__dirname, "search.html"));
        switchTab(firstViewId);
      }
    } else {
      // Diğer durumlarda normal davranış
      let initialUrl = "file://" + path.join(__dirname, "search.html"); // Default to search.html
      
      if (settings.homepage === "custom" && settings.customUrl) {
        // Validate the custom URL
        try {
          new URL(settings.customUrl);
          initialUrl = settings.customUrl;
        } catch (e) {
          console.log("Invalid custom URL, falling back to default:", e);
          initialUrl = "file://" + path.join(__dirname, "search.html");
        }
      }
      
      // İlk sekmeyi oluştur
      const firstViewId = createTab(initialUrl);
      switchTab(firstViewId);
    }
  });
  mainWindow.on("maximize", updateViewBounds);
  mainWindow.on("unmaximize", updateViewBounds);

  // Pencere göstermeye hazır olduğunda
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();

    // Daha iyi kullanıcı deneyimi için aktif görünüme odaklan
    if (activeViewId && views.has(activeViewId)) {
      views.get(activeViewId).webContents.focus();
    }
  });

  // index.html dosyasını yükle
  mainWindow.loadFile("index.html");

  // Create overlay window for floating search bar
  createOverlayWindow();

  // Geliştirme modunda DevTools'u aç - yarım ekran aşağıda
  if (isDev) {
    mainWindow.webContents.openDevTools({
      mode: "bottom",
      activate: false,
    });
  }

  // Sadece pencere kontrol butonlarını bırak, menü çubuğunu gizle
  if (process.platform !== "darwin") {
    Menu.setApplicationMenu(Menu.buildFromTemplate([]));
  } else {
    // macOS için minimal menü
    const template = [
      {
        label: app.getName(),
        submenu: [{ role: "quit" }],
      },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }
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
      preload: path.join(__dirname, "preload.js"),
    },
  });

  settingsWindow.loadFile("settings.html");

  if (isDev) {
    settingsWindow.webContents.openDevTools({
      mode: "bottom",
      activate: false,
    });
  }

  return settingsWindow;
}

// Google OAuth için yardımcı fonksiyonlar
async function getAuthTokens() {
  try {
    const tokens = await keytar.getPassword("rush-browser", "google-oauth");
    return tokens ? JSON.parse(tokens) : null;
  } catch (error) {
    console.error("Token alınamadı:", error);
    return null;
  }
}

async function saveAuthTokens(tokens) {
  try {
    await keytar.setPassword(
      "rush-browser",
      "google-oauth",
      JSON.stringify(tokens),
    );
  } catch (error) {
    console.error("Token kaydedilemedi:", error);
  }
}

async function clearAuthTokens() {
  try {
    await keytar.deletePassword("rush-browser", "google-oauth");
    store.delete("user-info");
  } catch (error) {
    console.error("Token silinemedi:", error);
  }
}

// Google ile giriş işlemi
async function signInWithGoogle() {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: [
      "https://www.googleapis.com/auth/userinfo.profile",
      "https://www.googleapis.com/auth/userinfo.email",
    ],
  });

  const authWindow = new BrowserWindow({
    width: 600,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  authWindow.loadURL(authUrl);

  return new Promise((resolve, reject) => {
    authWindow.webContents.on("will-navigate", async (event, url) => {
      try {
        if (url.startsWith(GOOGLE_REDIRECT_URI)) {
          const urlObj = new URL(url);
          const code = urlObj.searchParams.get("code");
          const { tokens } = await oauth2Client.getToken(code);

          await saveAuthTokens(tokens);
          oauth2Client.setCredentials(tokens);

          // Kullanıcı bilgilerini al
          const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
          const { data } = await oauth2.userinfo.get();

          // Kullanıcı bilgilerini kaydet
          store.set("user-info", {
            id: data.id,
            email: data.email,
            name: data.name,
            picture: data.picture,
          });

          authWindow.close();
          resolve(data);
        }
      } catch (error) {
        authWindow.close();
        reject(error);
      }
    });

    authWindow.on("closed", () => {
      reject(new Error("Kimlik doğrulama penceresi kapatıldı"));
    });
  });
}

// Kullanıcı oturumunu kapat
async function signOut() {
  await clearAuthTokens();
  oauth2Client.revokeCredentials();
}

// IPC işleyicileri
ipcMain.handle("get-zoom-factor", () => {
  if (activeViewId && views.has(activeViewId)) {
    return views.get(activeViewId).webContents.getZoomFactor();
  }
  return 1.0;
});

ipcMain.handle("set-zoom-factor", (event, factor) => {
  if (activeViewId && views.has(activeViewId)) {
    views.get(activeViewId).webContents.setZoomFactor(factor);
    return true;
  }
  return false;
});

ipcMain.handle("zoom-in", () => {
  if (activeViewId && views.has(activeViewId)) {
    const view = views.get(activeViewId);
    const currentZoom = view.webContents.getZoomFactor();
    const newZoom = Math.min(3.0, currentZoom + 0.1);
    view.webContents.setZoomFactor(newZoom);
    mainWindow.webContents.send("zoom-change", newZoom);
    return newZoom;
  }
  return 1.0;
});

ipcMain.handle("zoom-out", () => {
  if (activeViewId && views.has(activeViewId)) {
    const view = views.get(activeViewId);
    const currentZoom = view.webContents.getZoomFactor();
    const newZoom = Math.max(0.3, currentZoom - 0.1);
    view.webContents.setZoomFactor(newZoom);
    mainWindow.webContents.send("zoom-change", newZoom);
    return newZoom;
  }
  return 1.0;
});

ipcMain.handle("reset-zoom", () => {
  if (activeViewId && views.has(activeViewId)) {
    const view = views.get(activeViewId);
    view.webContents.setZoomFactor(1.0);
    mainWindow.webContents.send("zoom-change", 1.0);
    return 1.0;
  }
  return 1.0;
});

ipcMain.handle("navigate-to", (event, url) => {
  if (activeViewId && views.has(activeViewId)) {
    // Protokol yoksa ekle
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = "https://" + url;
    }
    views.get(activeViewId).webContents.loadURL(url);
    return true;
  }
  return false;
});

ipcMain.handle("go-back", () => {
  if (activeViewId && views.has(activeViewId)) {
    const view = views.get(activeViewId);
    if (view.webContents.navigationHistory.canGoBack()) {
      view.webContents.navigationHistory.goBack();
      return true;
    }
  }
  return false;
});

ipcMain.handle("go-forward", () => {
  if (activeViewId && views.has(activeViewId)) {
    const view = views.get(activeViewId);
    if (view.webContents.navigationHistory.canGoForward()) {
      view.webContents.navigationHistory.goForward();
      return true;
    }
  }
  return false;
});

ipcMain.handle("refresh", () => {
  if (activeViewId && views.has(activeViewId)) {
    views.get(activeViewId).webContents.reload();
    return true;
  }
  return false;
});

ipcMain.handle("go-home", () => {
  if (activeViewId && views.has(activeViewId)) {
    if (settings.homepage === "lastsession") {
      // Last session seçiliyse oturumu yükle
      const sessionLoaded = loadSession();
      if (!sessionLoaded) {
        // Oturum yüklenemezse varsayılana dön
        views.get(activeViewId).webContents.loadURL("file://" + path.join(__dirname, "search.html"));
      }
    } else {
      let homeUrl = "file://" + path.join(__dirname, "search.html"); // Default
      
      if (settings.homepage === "custom" && settings.customUrl) {
        try {
          new URL(settings.customUrl);
          homeUrl = settings.customUrl;
        } catch (e) {
          console.log("Invalid custom URL, using default home");
          homeUrl = "file://" + path.join(__dirname, "search.html");
        }
      }
      
      views.get(activeViewId).webContents.loadURL(homeUrl);
    }
    return true;
  }
  return false;
});

ipcMain.handle("get-current-url", () => {
  if (activeViewId && views.has(activeViewId)) {
    return views.get(activeViewId).webContents.getURL();
  }
  return "";
});

ipcMain.handle("get-current-title", () => {
  if (activeViewId && views.has(activeViewId)) {
    return views.get(activeViewId).webContents.getTitle();
  }
  return "Modern Browser";
});

// Quick Search Overlay Management
function showQuickSearchOverlay() {
  if (overlayWindow && mainWindow) {
    // Center overlay on main window
    const mainBounds = mainWindow.getBounds();
    const overlayBounds = overlayWindow.getBounds();
    
    overlayWindow.setBounds({
      x: mainBounds.x + (mainBounds.width - overlayBounds.width) / 2,
      y: mainBounds.y + (mainBounds.height - overlayBounds.height) / 2,
      width: overlayBounds.width,
      height: overlayBounds.height
    });
    
    // Show and focus the overlay
    overlayWindow.show();
    overlayWindow.focus();
  }
}

function hideQuickSearchOverlay() {
  if (overlayWindow) {
    overlayWindow.hide();
    
    // Return focus to main window
    if (mainWindow) {
      mainWindow.focus();
    }
  }
}

// Quick Search Overlay IPC handlers
ipcMain.handle("show-quick-search", () => {
  showQuickSearchOverlay();
});

ipcMain.handle("hide-quick-search", () => {
  hideQuickSearchOverlay();
});

ipcMain.handle("perform-overlay-search", async (event, query) => {
  try {
    // Get current search engine from settings
    const searchEngine = settings.searchEngine || 'google';
    
    // Search engines configuration
    const searchEngines = {
      google: "https://www.google.com/search?q=",
      bing: "https://www.bing.com/search?q=",
      duckduckgo: "https://duckduckgo.com/?q=",
      yahoo: "https://search.yahoo.com/search?p="
    };

    const searchUrl = searchEngines[searchEngine] + encodeURIComponent(query.trim());
    
    // Navigate current tab to search results
    if (activeViewId && views.has(activeViewId)) {
      const activeView = views.get(activeViewId);
      activeView.webContents.loadURL(searchUrl);
    }
    
    // Hide overlay after search
    hideQuickSearchOverlay();
    
    return { success: true };
  } catch (error) {
    console.error('Error performing overlay search:', error);
    return { success: false, error: error.message };
  }
});

// Ayarlar yönetimi
ipcMain.handle("get-settings", () => {
  return settings;
});

// Ayarlar sekmesini aç
ipcMain.handle("openSettingsTab", (event, section) => {
  const settingsUrl = `file://${path.join(__dirname, "settings.html")}${section ? `?section=${section}` : ""}`;
  const viewId = createTab(settingsUrl);
  switchTab(viewId);
  return viewId;
});

ipcMain.handle("save-settings", (event, newSettings) => {
  // Eski ayarları sakla
  const oldSettings = { ...settings };

  // Yeni ayarları uygula
  settings = { ...settings, ...newSettings };

  // Homepage URL'sini güncelle
  if (settings.homepage === "custom" && settings.customUrl) {
    try {
      new URL(settings.customUrl);
      settings.homeUrl = settings.customUrl;
    } catch (e) {
      console.log("Invalid custom URL provided, keeping default homeUrl");
      settings.homeUrl = "file://" + path.join(__dirname, "search.html");
    }
  } else {
    settings.homeUrl = "file://" + path.join(__dirname, "search.html");
  }

  // Store settings for persistence
  store.set("homepage", settings.homepage);
  store.set("customUrl", settings.customUrl);
  store.set("searchEngine", settings.searchEngine);
  store.set("clearOnExit", settings.clearOnExit);
  store.set("quickSearch", settings.quickSearch);
  store.set("darkMode", settings.darkMode);
  store.set("fontSize", settings.fontSize);

  // Zoom ayarlarını uygula
  if (settings.defaultZoom !== oldSettings.defaultZoom) {
    views.forEach((view) => {
      view.webContents.setZoomFactor(settings.defaultZoom);
    });
  }

  // JavaScript ayarlarını uygula
  if (settings.jsEnabled !== oldSettings.jsEnabled) {
    views.forEach((view) => {
      view.webContents.setJavaScriptEnabled(settings.jsEnabled);
    });
  }

  // Pop-up engelleme ayarlarını uygula
  if (settings.blockPopups !== oldSettings.blockPopups) {
    views.forEach((view) => {
      view.webContents.setWindowOpenHandler(({ url }) => {
        return settings.blockPopups ? { action: "deny" } : { action: "allow" };
      });
    });
  }

  // Tüm pencerelere ayar güncellemesini bildir
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send("settings-update", settings);
  });

  return true;
});

ipcMain.handle("reset-settings", () => {
  settings = {
    homeUrl: "https://www.google.com",
    defaultZoom: 1.0,
    jsEnabled: true,
    darkMode: false,
    fontSize: 14,
    startupOption: "homepage",
    blockPopups: true,
    cookieSettings: "allow",
    downloadPath: app.getPath("downloads"),
    askDownloadLocation: false,
  };

  // Tüm pencerelere ayar güncellemesini bildir
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send("settings-update", settings);
  });

  return settings;
});

// Yer imleri yönetimi
ipcMain.handle("get-bookmarks", () => {
  return bookmarks;
});

ipcMain.handle("add-bookmark", (event, bookmark) => {
  const existingIndex = bookmarks.findIndex((b) => b.url === bookmark.url);
  if (existingIndex >= 0) {
    bookmarks[existingIndex] = bookmark;
  } else {
    bookmarks.push(bookmark);
  }
  return true;
});

ipcMain.handle("remove-bookmark", (event, url) => {
  bookmarks = bookmarks.filter((b) => b.url !== url);
  return true;
});

ipcMain.handle("is-bookmarked", (event, url) => {
  return bookmarks.some((b) => b.url === url);
});

// Downloads management
ipcMain.handle("get-downloads", () => {
  return downloads;
});

ipcMain.handle("clear-completed-downloads", () => {
  downloads = downloads.filter((d) => d.status !== "completed");
  // Notify renderer about download updates
  mainWindow.webContents.send("download-update", downloads);
  return true;
});

ipcMain.handle("remove-download", (event, downloadId) => {
  downloads = downloads.filter((d) => d.id !== downloadId);
  // Notify renderer about download updates
  mainWindow.webContents.send("download-update", downloads);
  return true;
});

ipcMain.handle("open-download-folder", () => {
  shell.openPath(settings.downloadPath);
  return true;
});

ipcMain.handle("open-file", (event, filePath) => {
  shell.openPath(filePath);
  return true;
});

ipcMain.handle("show-in-folder", (event, filePath) => {
  shell.showItemInFolder(filePath);
  return true;
});

// Sistem bilgileri
ipcMain.handle("get-browser-version", () => {
  return app.getVersion();
});

ipcMain.handle("get-user-agent", () => {
  return view ? view.webContents.getUserAgent() : navigator.userAgent;
});

ipcMain.handle("clear-browsing-data", () => {
  if (view) {
    view.webContents.session.clearStorageData();
    view.webContents.session.clearCache();
    return true;
  }
  return false;
});

ipcMain.handle("get-download-path", () => {
  return settings.downloadPath;
});

ipcMain.handle("set-download-path", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
  });

  if (!result.canceled && result.filePaths.length > 0) {
    settings.downloadPath = result.filePaths[0];
    return settings.downloadPath;
  }

  return settings.downloadPath;
});

// Tema yönetimi - duplike handler kaldırıldı, aşağıdaki güncel versiyonu kullanılıyor

// Ayarlar penceresini aç
ipcMain.handle("open-settings", () => {
  createSettingsWindow();
  return true;
});

// Pencereyi kapat
ipcMain.handle("close-window", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    win.close();
    return true;
  }
  return false;
});

// Developer Tools IPC handlers
ipcMain.handle("toggle-dev-tools", (event, isOpen) => {
  if (!activeViewId || !views.has(activeViewId)) return false;

  const activeView = views.get(activeViewId);
  if (isOpen) {
    activeView.webContents.openDevTools({ mode: "bottom" });
  } else {
    activeView.webContents.closeDevTools();
  }
  return true;
});

ipcMain.handle("execute-javascript", async (event, code) => {
  if (!activeViewId || !views.has(activeViewId)) return null;

  const activeView = views.get(activeViewId);
  try {
    const result = await activeView.webContents.executeJavaScript(code);
    return { success: true, result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("get-page-source", async (event) => {
  if (!activeViewId || !views.has(activeViewId)) return null;

  const activeView = views.get(activeViewId);
  try {
    const source = await activeView.webContents.executeJavaScript(
      "document.documentElement.outerHTML",
    );
    return source;
  } catch (error) {
    return null;
  }
});

ipcMain.handle("get-console-messages", (event) => {
  // In a real implementation, you would track console messages
  // For now, return empty array
  return [];
});

ipcMain.handle("clear-console-messages", (event) => {
  // Clear stored console messages
  return true;
});

// IPC event handlers
ipcMain.handle("open-settings-tab", (event, section) => {
  return openSettings(section);
});

ipcMain.handle("open-downloads-tab", () => {
  return openDownloadsTab();
});

// Tab event handlers
ipcMain.handle("new-tab", (event, url) => {
  // Check if Quick Search is enabled
  if (settings.quickSearch) {
    // Show overlay window instead of creating new tab
    showQuickSearchOverlay();
    return null; // Don't create a new tab
  }
  
  const viewId = createTab(url);
  switchTab(viewId);
  return viewId;
});

ipcMain.handle("switch-tab", (event, viewId) => {
  console.log(`[IPC] switch-tab request for viewId: ${viewId}`);

  if (!viewId) {
    console.error("[IPC] switch-tab called with invalid viewId");
    return false;
  }

  const result = switchTab(viewId);
  console.log(`[IPC] switch-tab result: ${result}`);
  return result;
});

ipcMain.handle("close-tab", (event, viewId) => {
  closeTab(viewId);
  return true;
});

ipcMain.handle("get-tabs", () => {
  const tabs = [];
  for (const [id, view] of views) {
    tabs.push({
      id,
      url: view.webContents.getURL(),
      title: view.webContents.getTitle(),
      active: id === activeViewId,
    });
  }
  return tabs;
});

ipcMain.handle("reorder-tabs", (event, newOrder) => {
  console.log(`[IPC] Reordering tabs to: ${newOrder.join(", ")}`);

  // Validate that all tab IDs exist
  const validOrder = newOrder.filter((id) => views.has(id));

  if (validOrder.length !== newOrder.length) {
    console.warn("[IPC] Some tab IDs in reorder request do not exist");
    return false;
  }

  // The actual reordering is handled in the renderer process
  // We just acknowledge the change here and could update any internal ordering if needed

  // Send updated tab list to renderer
  const tabs = [];
  for (const id of validOrder) {
    if (views.has(id)) {
      const view = views.get(id);
      tabs.push({
        id,
        url: view.webContents.getURL(),
        title: view.webContents.getTitle(),
        active: id === activeViewId,
      });
    }
  }

  // Notify renderer about the new order
  mainWindow.webContents.send("tabs-reordered", tabs);

  return true;
});

// URL güncellemesi için event gönder - ENHANCED REAL-TIME
function updateUrlInView(url) {
  if (mainWindow && url) {
    // Send immediate URL update
    mainWindow.webContents.send("url-update", url);

    // Get current title for comprehensive update
    let currentTitle = "";
    if (activeViewId && views.has(activeViewId)) {
      const activeView = views.get(activeViewId);
      currentTitle = activeView.webContents.getTitle();
    }

    // Send title update with URL
    mainWindow.webContents.send("title-update", {
      title: currentTitle,
      url: url,
    });

    // Update window title
    updateWindowTitle(currentTitle, url);

    // Send comprehensive tab update for active tab
    if (activeViewId && views.has(activeViewId)) {
      mainWindow.webContents.send("tab-update", {
        id: activeViewId,
        url: url,
        title: currentTitle,
        active: true,
      });
    }

    // Force a delayed update to catch any async changes
    setTimeout(() => {
      if (activeViewId && views.has(activeViewId)) {
        const activeView = views.get(activeViewId);
        const latestUrl = activeView.webContents.getURL();
        const latestTitle = activeView.webContents.getTitle();

        if (latestUrl !== url || latestTitle !== currentTitle) {
          mainWindow.webContents.send("url-update", latestUrl);
          mainWindow.webContents.send("title-update", {
            title: latestTitle,
            url: latestUrl,
          });
          mainWindow.webContents.send("tab-update", {
            id: activeViewId,
            url: latestUrl,
            title: latestTitle,
            active: true,
          });
          updateWindowTitle(latestTitle, latestUrl);
        }
      }
    }, 200);
  }
}

// Yeni sekme oluşturma fonksiyonu
function createTab(url = null, options = {}) {
  const viewId = nextViewId++;

  // BrowserView oluştur
  const view = new BrowserView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  // Özel sekme başlığı varsa onu kullan
  if (options.title) {
    view.webContents.on("did-start-loading", () => {
      mainWindow.webContents.send("tab-title-updated", {
        id: viewId,
        title: options.title,
      });
    });
  }

  mainWindow.addBrowserView(view);
  views.set(viewId, view);

  // View olaylarını ayarla
  setupViewEvents(view, viewId);

  // Font size CSS'ini view'a enjekte et
  view.webContents.on("did-finish-load", () => {
    const fontSizeCSS = generateFontSizeCSS(settings.fontSize);
    view.webContents.insertCSS(fontSizeCSS);
  });

  // Varsayılan URL'yi yükle
  const loadUrl = url || settings.homeUrl;
  view.webContents.loadURL(loadUrl);

  // Last session aktifse oturumu kaydet
  if (settings.homepage === "lastsession") {
    setTimeout(() => saveSession(), 1000); // Kısa gecikme ile kaydet
  }

  return viewId;
}

// Ayarları yeni sekmede aç
function openSettings(section = "general") {
  const settingsUrl = `file://${path.join(__dirname, "settings.html")}#${section}`;
  const viewId = createTab(settingsUrl, {
    title: "Rush:GeneralSettings", // Özel sekme başlığı
  });
  switchTab(viewId);
  return viewId;
}

// Downloads sayfasını aç veya odaklan
function openOrFocusDownloadsTab() {
  const downloadsUrl = `file://${path.join(__dirname, "downloads.html")}`;
  
  // Check if downloads tab is already open
  let downloadsViewId = null;
  for (const [viewId, view] of views) {
    const currentUrl = view.webContents.getURL();
    if (currentUrl.includes('downloads.html')) {
      downloadsViewId = viewId;
      break;
    }
  }
  
  if (downloadsViewId) {
    // Downloads tab exists, switch to it
    switchTab(downloadsViewId);
    return downloadsViewId;
  } else {
    // Create new downloads tab
    const viewId = createTab(downloadsUrl, {
      title: "Rush:Downloads",
    });
    switchTab(viewId);
    return viewId;
  }
}

// Downloads sayfasını yeni sekmede aç (IPC handler için)
function openDownloadsTab() {
  return openOrFocusDownloadsTab();
}

// View olaylarını ayarla
function setupViewEvents(view, viewId) {
  // Helper function to update tab info and send real-time updates
  const updateTabInfo = (url = null, title = null) => {
    const currentUrl = url || view.webContents.getURL();
    const currentTitle = title || view.webContents.getTitle();

    // ALWAYS send tab update to main window (real-time)
    mainWindow.webContents.send("tab-update", {
      id: viewId,
      url: currentUrl,
      title: currentTitle,
      active: viewId === activeViewId,
    });

    // Update URL and title for active tab
    if (viewId === activeViewId) {
      // Send URL update immediately
      updateUrlInView(currentUrl);
      updateWindowTitle(currentUrl, currentTitle);

      // Send real-time title update
      mainWindow.webContents.send("title-update", {
        title: currentTitle,
        url: currentUrl,
      });
    }
  };

  // Real-time URL and title tracking
  const sendRealTimeUpdate = (url = null, title = null) => {
    const currentUrl = url || view.webContents.getURL();
    const currentTitle = title || view.webContents.getTitle();

    // Always update tab info
    updateTabInfo(currentUrl, currentTitle);

    // If this is active tab, send immediate updates
    if (viewId === activeViewId) {
      setTimeout(() => {
        const latestUrl = view.webContents.getURL();
        const latestTitle = view.webContents.getTitle();
        if (latestUrl !== currentUrl || latestTitle !== currentTitle) {
          updateTabInfo(latestUrl, latestTitle);
        }
      }, 50); // Quick double-check for real-time accuracy
    }
  };

  // Navigation events - real-time URL updates
  view.webContents.on("will-navigate", (event, url) => {
    sendRealTimeUpdate(url);
  });

  view.webContents.on("did-start-navigation", (event, url) => {
    sendRealTimeUpdate(url);
  });

  view.webContents.on("did-navigate", (event, url) => {
    sendRealTimeUpdate(url);
    // Last session aktifse oturumu kaydet
    if (settings.homepage === "lastsession") {
      setTimeout(() => saveSession(), 1000);
    }
  });

  view.webContents.on("did-navigate-in-page", (event, url) => {
    sendRealTimeUpdate(url);
    // Last session aktifse oturumu kaydet
    if (settings.homepage === "lastsession") {
      setTimeout(() => saveSession(), 1000);
    }
  });

  // Loading events
  view.webContents.on("did-start-loading", () => {
    const currentUrl = view.webContents.getURL();
    sendRealTimeUpdate(currentUrl);
    if (viewId === activeViewId) {
      mainWindow.webContents.send("loading-started");
    }
  });

  view.webContents.on("did-stop-loading", () => {
    sendRealTimeUpdate();
    if (viewId === activeViewId) {
      mainWindow.webContents.send("loading-stopped");
    }
  });

  // Title updates - real-time with multiple triggers
  view.webContents.on("page-title-updated", (event, title) => {
    sendRealTimeUpdate(null, title);
  });

  // Additional title monitoring events
  view.webContents.on("did-finish-load", () => {
    sendRealTimeUpdate();
    // Force title update after page load
    setTimeout(() => {
      const currentTitle = view.webContents.getTitle();
      if (viewId === activeViewId && currentTitle) {
        mainWindow.webContents.send("title-update", {
          title: currentTitle,
          url: view.webContents.getURL(),
        });
      }
    }, 100);
  });

  // Monitor title changes on DOM mutations
  view.webContents.on("dom-ready", () => {
    sendRealTimeUpdate();
    // Inject title monitoring script
    view.webContents
      .executeJavaScript(
        `
      let lastTitle = document.title;
      const titleObserver = new MutationObserver(() => {
        if (document.title !== lastTitle) {
          lastTitle = document.title;
          // Title changed, notify main process
        }
      });
      titleObserver.observe(document.head, {
        subtree: true,
        childList: true
      });
    `,
      )
      .catch(() => {});
  });

  // Additional real-time monitoring
  let lastUrl = "";
  let lastTitle = "";

  const checkForChanges = () => {
    try {
      const currentUrl = view.webContents.getURL();
      const currentTitle = view.webContents.getTitle();

      if (currentUrl !== lastUrl || currentTitle !== lastTitle) {
        lastUrl = currentUrl;
        lastTitle = currentTitle;
        updateTabInfo(currentUrl, currentTitle);
      }
    } catch (error) {
      // Ignore errors when view is destroyed
    }
  };

  // Monitor changes every 100ms for ultra-fast title updates
  const monitorInterval = setInterval(checkForChanges, 100);

  // Additional title-specific monitoring every 50ms for active tab
  const titleMonitorInterval = setInterval(() => {
    if (viewId === activeViewId) {
      try {
        const currentTitle = view.webContents.getTitle();
        const currentUrl = view.webContents.getURL();
        if (currentTitle !== lastTitle) {
          lastTitle = currentTitle;
          mainWindow.webContents.send("title-update", {
            title: currentTitle,
            url: currentUrl,
          });
          updateWindowTitle(currentTitle, currentUrl);
        }
      } catch (error) {
        // Ignore errors when view is destroyed
      }
    }
  }, 50);

  // Clean up intervals when view is destroyed
  view.webContents.on("destroyed", () => {
    clearInterval(monitorInterval);
    clearInterval(titleMonitorInterval);
  });

  view.webContents.on(
    "did-fail-load",
    (event, errorCode, errorDescription, validatedURL) => {
      if (errorCode !== -3) {
        view.webContents.loadFile("error.html", {
          query: {
            errorCode: errorCode,
            errorDescription: errorDescription,
            url: validatedURL,
          },
        });
      }
    },
  );

  view.webContents.setWindowOpenHandler(({ url }) => {
    createTab(url);
    return { action: "deny" };
  });

  // Note: Download handler is set up globally in createWindow function

  // Context menu (sağ tık) için olay dinleyicisi ekle
  view.webContents.on("context-menu", (event, params) => {
    const { mediaType, srcURL, linkURL, linkText, selectionText, editFlags } =
      params;

    console.log("Context menu params:", {
      mediaType,
      srcURL,
      linkURL,
      hasSelection: !!selectionText,
    });

    // Öncelik sırası: Resim > Link > Seçili Metin > Genel

    // Eğer sağ tıklanan öğe bir resim ise (linkli resim olsa bile önce resim menüsü)
    if (mediaType === "image" && srcURL) {
      const menu = Menu.buildFromTemplate([
        {
          label: "Open Image in Current Tab",
          click: () => {
            view.webContents.loadURL(srcURL);
          },
        },
        {
          label: "Open Image in New Tab",
          click: () => {
            const newTabId = createTab(srcURL);
            switchTab(newTabId);
          },
        },
        { type: "separator" },
        {
          label: "Copy Image",
          click: async () => {
            try {
              // Resmi indir ve clipboard'a kopyala
              const request = net.request(srcURL);

              request.on("response", (response) => {
                const chunks = [];

                response.on("data", (chunk) => {
                  chunks.push(chunk);
                });

                response.on("end", () => {
                  try {
                    const buffer = Buffer.concat(chunks);
                    const image = nativeImage.createFromBuffer(buffer);
                    clipboard.writeImage(image);

                    // Kullanıcıya bildirim gönder
                    mainWindow.webContents.send("image-copied", {
                      success: true,
                    });
                  } catch (error) {
                    console.error("Image processing failed:", error);
                    mainWindow.webContents.send("image-copied", {
                      success: false,
                      error: error.message,
                    });
                  }
                });
              });

              request.on("error", (error) => {
                console.error("Image download failed:", error);
                mainWindow.webContents.send("image-copied", {
                  success: false,
                  error: error.message,
                });
              });

              request.end();
            } catch (error) {
              console.error("Image copy failed:", error);
              mainWindow.webContents.send("image-copied", {
                success: false,
                error: error.message,
              });
            }
          },
        },
        {
          label: "Copy Image Address",
          click: () => {
            clipboard.writeText(srcURL);
            mainWindow.webContents.send("image-address-copied", {
              success: true,
            });
          },
        },
        { type: "separator" },
        {
          label: "Save Image As...",
          click: async () => {
            try {
              const result = await dialog.showSaveDialog(mainWindow, {
                title: "Save Image",
                defaultPath: path.join(app.getPath("downloads"), "image.jpg"),
                filters: [
                  {
                    name: "Images",
                    extensions: ["jpg", "jpeg", "png", "gif", "webp", "bmp"],
                  },
                  { name: "All Files", extensions: ["*"] },
                ],
              });

              if (!result.canceled && result.filePath) {
                const request = net.request(srcURL);

                request.on("response", (response) => {
                  const chunks = [];

                  response.on("data", (chunk) => {
                    chunks.push(chunk);
                  });

                  response.on("end", () => {
                    try {
                      const buffer = Buffer.concat(chunks);
                      require("fs").writeFileSync(result.filePath, buffer);
                      mainWindow.webContents.send("image-saved", {
                        success: true,
                        path: result.filePath,
                      });
                    } catch (error) {
                      console.error("Image save failed:", error);
                      mainWindow.webContents.send("image-saved", {
                        success: false,
                        error: error.message,
                      });
                    }
                  });
                });

                request.on("error", (error) => {
                  console.error("Image download failed:", error);
                  mainWindow.webContents.send("image-saved", {
                    success: false,
                    error: error.message,
                  });
                });

                request.end();
              }
            } catch (error) {
              console.error("Save dialog failed:", error);
              mainWindow.webContents.send("image-saved", {
                success: false,
                error: error.message,
              });
            }
          },
        },
        { type: "separator" },
        {
          role: "cut",
          enabled: editFlags && editFlags.canCut,
        },
        {
          role: "copy",
          enabled: editFlags && editFlags.canCopy,
        },
        {
          role: "paste",
          enabled: editFlags && editFlags.canPaste,
        },
        { type: "separator" },
        { role: "selectall" },
      ]);

      menu.popup(mainWindow, params.x, params.y);
    }
    // Eğer sağ tıklanan öğe bir link ise (ama resim değilse)
    else if (linkURL && mediaType !== "image") {
      const menu = Menu.buildFromTemplate([
        {
          label: "Open Link in New Tab",
          click: () => {
            const newTabId = createTab(linkURL);
            switchTab(newTabId);
          },
        },
        {
          label: "Open Link in New Tab (Background)",
          click: () => {
            createTab(linkURL); // Yeni sekme arka planda kalır
          },
        },
        {
          label: "Copy Link Address",
          click: () => {
            clipboard.writeText(linkURL);
            mainWindow.webContents.send("link-copied", {
              success: true,
              url: linkURL,
            });
          },
        },
        { type: "separator" },
        {
          label: "Open Link in Current Tab",
          click: () => {
            view.webContents.loadURL(linkURL);
          },
        },
        { type: "separator" },
        {
          role: "cut",
          enabled: editFlags && editFlags.canCut,
        },
        {
          role: "copy",
          enabled: editFlags && editFlags.canCopy,
        },
        {
          role: "paste",
          enabled: editFlags && editFlags.canPaste,
        },
        { type: "separator" },
        { role: "selectall" },
      ]);

      menu.popup({ window: mainWindow });
    }
    // Eğer metin seçilmişse
    else if (selectionText && selectionText.trim()) {
      const menu = Menu.buildFromTemplate([
        {
          role: "cut",
          enabled: editFlags && editFlags.canCut,
        },
        {
          role: "copy",
          enabled: editFlags && editFlags.canCopy,
        },
        {
          role: "paste",
          enabled: editFlags && editFlags.canPaste,
        },
        { type: "separator" },
        {
          label: "Search in New Tab",
          click: () => {
            const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(selectionText)}`;
            const newTabId = createTab(searchUrl);
            switchTab(newTabId);
          },
        },
        { type: "separator" },
        { role: "selectall" },
      ]);

      menu.popup({ window: mainWindow });
    } else {
      // Normal context menu (varsayılan)
      const menu = Menu.buildFromTemplate([
        {
          role: "cut",
          enabled: editFlags && editFlags.canCut,
        },
        {
          role: "copy",
          enabled: editFlags && editFlags.canCopy,
        },
        {
          role: "paste",
          enabled: editFlags && editFlags.canPaste,
        },
        { type: "separator" },
        { role: "selectall" },
        { type: "separator" },
        {
          label: "New Tab",
          click: () => {
            const newTabId = createTab(settings.homeUrl);
            switchTab(newTabId);
          },
        },
        { type: "separator" },
        {
          label: "Back",
          enabled: view.webContents.navigationHistory.canGoBack(),
          click: () => {
            view.webContents.navigationHistory.goBack();
          },
        },
        {
          label: "Forward",
          enabled: view.webContents.navigationHistory.canGoForward(),
          click: () => {
            view.webContents.navigationHistory.goForward();
          },
        },
        {
          label: "Reload",
          click: () => {
            view.webContents.reload();
          },
        },
        { type: "separator" },
        {
          label: "View Page Source",
          click: () => {
            view.webContents
              .executeJavaScript(
                `
              const source = document.documentElement.outerHTML;
              window.electronAPI && window.electronAPI.showPageSource && window.electronAPI.showPageSource(source);
            `,
              )
              .catch(() => {
                // Fallback: yeni sekmede source'u göster
                const sourceUrl =
                  "data:text/html;charset=utf-8," +
                  encodeURIComponent(
                    `<!DOCTYPE html><html><head><title>Page Source</title><style>
                  body { font-family: monospace; white-space: pre; background: #1e1e1e; color: #d4d4d4; padding: 20px; }
                </style></head><body>Loading page source...</body></html>`,
                  );
                const newTabId = createTab(sourceUrl);
                switchTab(newTabId);
              });
          },
        },
        {
          label: "Inspect Element",
          click: () => {
            view.webContents.inspectElement(params.x, params.y);
          },
        },
      ]);

      menu.popup({ window: mainWindow });
    }
  });
}

// Sekme değiştirme fonksiyonu - IMPROVED
function switchTab(viewId) {
  console.log(
    `[switchTab] Switching to tab ${viewId}, current active: ${activeViewId}`,
  );

  if (!views.has(viewId)) {
    console.error(`[switchTab] View ${viewId} not found!`);
    return false;
  }

  // Aynı sekmeye geçiş yapmaya çalışıyorsa, işlemi atla
  if (activeViewId === viewId) {
    console.log(`[switchTab] Already on tab ${viewId}, skipping`);
    // Even if we're already on this tab, ensure UI is synchronized
    const view = views.get(viewId);
    const url = view.webContents.getURL();
    const title = view.webContents.getTitle();

    mainWindow.webContents.send("tab-update", {
      id: viewId,
      url: url,
      title: title,
      active: true,
    });

    return true;
  }

  try {
    // Mevcut sekmeyi güvenli şekilde gizle
    if (activeViewId && views.has(activeViewId)) {
      const oldView = views.get(activeViewId);
      console.log(`[switchTab] Removing old view ${activeViewId}`);

      // Old view'ı kaldırmadan önce kontrol et
      try {
        // Send inactive state for old tab first
        mainWindow.webContents.send("tab-update", {
          id: activeViewId,
          url: oldView.webContents.getURL(),
          title: oldView.webContents.getTitle(),
          active: false,
        });

        mainWindow.removeBrowserView(oldView);
      } catch (error) {
        console.error(`[switchTab] Error removing old view:`, error);
      }
    }

    // Yeni sekmeyi güvenli şekilde göster
    const newView = views.get(viewId);
    console.log(`[switchTab] Adding new view ${viewId}`);

    try {
      mainWindow.addBrowserView(newView);
      activeViewId = viewId;
    } catch (error) {
      console.error(`[switchTab] Error adding new view:`, error);
      return false;
    }

    // View sınırlarını güncelle
    updateViewBounds();

    // Focus'u yeni view'a ver
    try {
      newView.webContents.focus();
    } catch (error) {
      console.error(`[switchTab] Error focusing new view:`, error);
    }

    // URL ve başlığı güncelle
    const url = newView.webContents.getURL();
    const title = newView.webContents.getTitle();

    console.log(`[switchTab] New tab info: ${title} - ${url}`);

    // Send immediate active state for new tab
    mainWindow.webContents.send("tab-update", {
      id: viewId,
      url: url,
      title: title,
      active: true,
    });

    // Aktif sekme için ekstra güncellemeler
    mainWindow.webContents.send("url-update", url);
    mainWindow.webContents.send("title-update", {
      title: title,
      url: url,
    });

    // Window title'ı güncelle
    updateWindowTitle(title, url);

    console.log(`[switchTab] Successfully switched to tab ${viewId}`);
    return true;
  } catch (error) {
    console.error(`[switchTab] Fatal error switching tab:`, error);
    return false;
  }
}

// Sekme kapatma fonksiyonu - IMPROVED
function closeTab(viewId) {
  console.log(`[closeTab] Closing tab ${viewId}`);

  if (!views.has(viewId)) {
    console.error(`[closeTab] View ${viewId} not found!`);
    return false;
  }

  const view = views.get(viewId);

  try {
    // Eğer aktif sekme kapatılıyorsa, başka bir sekmeye geç
    if (viewId === activeViewId) {
      const viewIds = Array.from(views.keys());
      const currentIndex = viewIds.indexOf(viewId);

      // Sekme seçim mantığı: sol taraftan seç, yoksa sağ taraftan
      let newIndex = currentIndex > 0 ? currentIndex - 1 : currentIndex + 1;

      // Eğer bu son sekme değilse, başka bir sekmeye geç
      if (viewIds.length > 1 && viewIds[newIndex]) {
        console.log(
          `[closeTab] Switching to tab ${viewIds[newIndex]} before closing`,
        );
        const switchResult = switchTab(viewIds[newIndex]);
        if (!switchResult) {
          console.error(`[closeTab] Failed to switch to replacement tab`);
          // Don't abort - continue with closing
        }
      }
    }

    // View'ı güvenli şekilde temizle ve kaldır
    try {
      // Clean up active view ID before removing
      if (activeViewId === viewId) {
        activeViewId = null;
      }

      // Remove from main window
      mainWindow.removeBrowserView(view);

      // Clean up any event listeners or intervals
      if (view.webContents && !view.webContents.isDestroyed()) {
        try {
          view.webContents.removeAllListeners();
        } catch (error) {
          console.error(`[closeTab] Error cleaning up webContents:`, error);
        }
      }
    } catch (error) {
      console.error(`[closeTab] Error removing view:`, error);
    }

    // View'ı maps'ten sil
    views.delete(viewId);
    console.log(
      `[closeTab] Removed view ${viewId}, remaining views: ${views.size}`,
    );

    // Eğer son sekme kapatıldıysa, yeni bir sekme aç
    if (views.size === 0) {
      console.log("[closeTab] No tabs remaining, creating new tab");
      const newViewId = createTab(settings.homeUrl);
      switchTab(newViewId);
    }

    // UI'ı güncelle - send immediate update
    mainWindow.webContents.send("tab-closed", viewId);

    // Last session aktifse oturumu kaydet
    if (settings.homepage === "lastsession") {
      setTimeout(() => saveSession(), 500); // Kısa gecikme ile kaydet
    }

    console.log(`[closeTab] Successfully closed tab ${viewId}`);
    return true;
  } catch (error) {
    console.error(`[closeTab] Fatal error closing tab:`, error);
    return false;
  }
}

function updateWindowTitle(title, url) {
  if (!mainWindow) return;

  try {
    if (title && title.trim()) {
      mainWindow.setTitle(`${title} - Modern Browser`);
    } else if (url) {
      const urlObj = new URL(url);
      const domain = urlObj.hostname;
      mainWindow.setTitle(`${domain} - Modern Browser`);
    } else {
      mainWindow.setTitle("Modern Browser");
    }
  } catch (error) {
    mainWindow.setTitle("Modern Browser");
  }
}
function createMenu() {
  const template = [
    {
      label: "File",
      submenu: [
        {
          label: "New Tab",
          accelerator: "CmdOrCtrl+T",
          click: () => {
            // Yeni sekme oluştur ve settings.homeUrl'i kullan
            const newTabId = createTab(settings.homeUrl);
            switchTab(newTabId);
          },
        },
        {
          label: "New Window",
          accelerator: "CmdOrCtrl+N",
          click: () => {
            createWindow();
          },
        },
        { type: "separator" },
        {
          label: "Close",
          accelerator: process.platform === "darwin" ? "Cmd+W" : "Ctrl+W",
          click: () => {
            if (mainWindow) {
              mainWindow.close();
            }
          },
        },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectall" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Navigation",
      submenu: [
        {
          label: "Back",
          accelerator: "Alt+Left",
          click: () => {
            if (activeViewId && views.has(activeViewId)) {
              const view = views.get(activeViewId);
              if (view.webContents.navigationHistory.canGoBack()) {
                view.webContents.navigationHistory.goBack();
              }
            }
          },
        },
        {
          label: "Forward",
          accelerator: "Alt+Right",
          click: () => {
            if (activeViewId && views.has(activeViewId)) {
              const view = views.get(activeViewId);
              if (view.webContents.navigationHistory.canGoForward()) {
                view.webContents.navigationHistory.goForward();
              }
            }
          },
        },
        {
          label: "Refresh",
          accelerator: "F5",
          click: () => {
            if (activeViewId && views.has(activeViewId)) {
              views.get(activeViewId).webContents.reload();
            }
          },
        },
        {
          label: "Home",
          accelerator: "Alt+Home",
          click: () => {
            if (activeViewId && views.has(activeViewId)) {
              views.get(activeViewId).webContents.loadURL(settings.homeUrl);
            }
          },
        },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "close" }],
    },
  ];

  // macOS specific menu adjustments
  if (process.platform === "darwin") {
    template.unshift({
      label: app.getName(),
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideothers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });

    // Window menu
    template[5].submenu = [
      { role: "close" },
      { role: "minimize" },
      { role: "zoom" },
      { type: "separator" },
      { role: "front" },
    ];
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// App event handlers
app.whenReady().then(() => {
  // Load stored settings before creating window
  loadStoredSettings();
  
  createWindow();

  // Handle app activation (macOS)
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed
app.on("window-all-closed", () => {
  if (settings.clearOnExit) {
    console.log("Clear on exit is enabled, clearing all data...");
    clearDataOnExit();
  } else if (settings.homepage === "lastsession") {
    saveSession();
  }
  
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// App kapanmadan önce oturumu kaydet veya verileri temizle
app.on("before-quit", (event) => {
  if (settings.clearOnExit) {
    console.log("Clear on exit is enabled, clearing all data...");
    clearDataOnExit();
  } else if (settings.homepage === "lastsession") {
    saveSession();
  }
});

// Security: Prevent new window creation
app.on("web-contents-created", (event, contents) => {
  contents.on("new-window", (event, navigationUrl) => {
    // Prevent new window creation and open in default browser instead
    event.preventDefault();
    shell.openExternal(navigationUrl);
  });
});

// Handle certificate errors
app.on(
  "certificate-error",
  (event, webContents, url, error, certificate, callback) => {
    if (isDev) {
      // In development, ignore certificate errors
      event.preventDefault();
      callback(true);
    } else {
      // In production, use default behavior
      callback(false);
    }
  },
);

// Prevent navigation to external protocols
app.on("web-contents-created", (event, contents) => {
  contents.on("will-navigate", (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);

    if (
      parsedUrl.origin !== "https://www.google.com" &&
      !navigationUrl.startsWith("https://")
    ) {
      console.log("Blocked navigation to:", navigationUrl);
      event.preventDefault(); // Güvenli olmayan URL'lere navigasyonu engelle
    }
  });
});

// Graceful shutdown
app.on("before-quit", () => {
  // Clear data if clearOnExit is enabled
  console.log("Application is quitting...");
  
  if (settings.clearOnExit) {
    console.log("Clear on exit is enabled, clearing all data...");
    clearDataOnExit();
  }
});

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);

  // Log error details
  const errorDetails = {
    message: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString(),
  };

  // Show error dialog to user
  if (mainWindow) {
    dialog.showErrorBox(
      "An error occurred",
      `The application encountered an unexpected error.\n\nError: ${error.message}\n\nThe application will continue running, but some features may not work correctly.`,
    );
  }

  // You could also save error logs to a file here
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);

  // Log rejection details
  const rejectionDetails = {
    reason: reason
      ? reason.stack || reason.message || String(reason)
      : "Unknown reason",
    timestamp: new Date().toISOString(),
  };

  // You could also save rejection logs to a file here
});

// IPC işleyicileri ekle
ipcMain.handle("google-sign-in", async () => {
  try {
    const result = await signInWithGoogle();
    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("google-sign-out", async () => {
  try {
    await signOut();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("get-google-user-info", () => {
  return store.get("user-info");
});

// Uygulama başlatılırken mevcut token'ları kontrol et
app.whenReady().then(async () => {
  const tokens = await getAuthTokens();
  if (tokens) {
    oauth2Client.setCredentials(tokens);
  }
});

// Tema yönetimi için fonksiyonlar
function updateBrowserTheme(isDarkMode) {
  if (mainWindow) {
    // Ana pencere temasını güncelle
    mainWindow.webContents.send("theme-changed", isDarkMode);
  }

  // Tüm sekmelerin temasını güncelle
  views.forEach((view, viewId) => {
    view.webContents.send("theme-changed", isDarkMode);
  });
}

// Tema değişikliği isteğini işle
ipcMain.handle("toggle-dark-mode", async (event, isDarkMode) => {
  settings.darkMode = isDarkMode;
  // Save to persistent storage
  store.set("darkMode", isDarkMode);
  updateBrowserTheme(isDarkMode);
  return isDarkMode;
});

// Tema durumunu sorgula
ipcMain.handle("is-dark-mode", () => {
  return settings.darkMode;
});

// Font size ayarını uygula
ipcMain.handle("set-font-size", (event, fontSize) => {
  settings.fontSize = fontSize;
  store.set("fontSize", fontSize);
  
  // Font size CSS'ini oluştur
  const fontSizeCSS = generateFontSizeCSS(fontSize);
  
  // Tüm view'lara CSS enjekte et
  views.forEach((view) => {
    view.webContents.insertCSS(fontSizeCSS);
  });
  
  // Tüm açık pencerelere font size güncellemesini gönder
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send("font-size-changed", fontSize);
  });
  
  return fontSize;
});

// Font size CSS'ini oluştur
function generateFontSizeCSS(fontSize) {
  let multiplier = 1;
  if (fontSize === 'small') {
    multiplier = 0.9;
  } else if (fontSize === 'large') {
    multiplier = 1.1;
  }
  
  return `
    * {
      font-size: ${multiplier}rem !important;
    }
    h1 { font-size: ${multiplier * 2}rem !important; }
    h2 { font-size: ${multiplier * 1.5}rem !important; }
    h3 { font-size: ${multiplier * 1.17}rem !important; }
    h4 { font-size: ${multiplier * 1}rem !important; }
    h5 { font-size: ${multiplier * 0.83}rem !important; }
    h6 { font-size: ${multiplier * 0.67}rem !important; }
    small { font-size: ${multiplier * 0.8}rem !important; }
    input, textarea, select, button { 
      font-size: ${multiplier}rem !important; 
    }
    .font-size-override-${fontSize} * {
      font-size: inherit !important;
    }
  `;
}

// Font size durumunu sorgula
ipcMain.handle("get-font-size", () => {
  return settings.fontSize || "medium";
});

// BrowserWindow oluşturulduğunda tema ayarını uygula
function applyInitialTheme(window) {
  if (settings.darkMode) {
    updateBrowserTheme(true);
  }
}

// Download control IPC handlers
ipcMain.handle('pause-download', (event, downloadId) => {
  try {
    const download = downloads.find(d => d.id === downloadId);
    if (download && download.item && download.item.canPause()) {
      download.item.pause();
      download.status = 'paused';
      mainWindow.webContents.send('download-update', downloads);
      return true;
    }
    return false;
  } catch (error) {
    console.error(`Error pausing download ${downloadId}:`, error);
    return false;
  }
});

ipcMain.handle('resume-download', (event, downloadId) => {
  try {
    const download = downloads.find(d => d.id === downloadId);
    if (download && download.item && download.item.canResume()) {
      download.item.resume();
      download.status = 'progressing';
      mainWindow.webContents.send('download-update', downloads);
      return true;
    }
    return false;
  } catch (error) {
    console.error(`Error resuming download ${downloadId}:`, error);
    return false;
  }
});

ipcMain.handle('cancel-download', (event, downloadId) => {
  try {
    const download = downloads.find(d => d.id === downloadId);
    if (download && download.item) {
      download.item.cancel();
      download.status = 'cancelled';
      mainWindow.webContents.send('download-update', downloads);
      return true;
    }
    return false;
  } catch (error) {
    console.error(`Error cancelling download ${downloadId}:`, error);
    return false;
  }
});

ipcMain.handle('retry-download', async (event, downloadId) => {
  try {
    const download = downloads.find(d => d.id === downloadId);
    if (download && download.url) {
      // Remove the old download
      downloads = downloads.filter(d => d.id !== downloadId);
      
      // Start a new download with the same URL
      const response = await session.defaultSession.downloadURL(download.url);
      return true;
    }
    return false;
  } catch (error) {
    console.error(`Error retrying download ${downloadId}:`, error);
    return false;
  }
});

ipcMain.handle('get-download-speed', (event, downloadId) => {
  try {
    const download = downloads.find(d => d.id === downloadId);
    return download ? download.speed : 0;
  } catch (error) {
    console.error(`Error getting download speed for ${downloadId}:`, error);
    return 0;
  }
});

// Manuel veri temizleme (test için)
ipcMain.handle("clear-all-data-now", () => {
  try {
    console.log("Manual data clearing requested");
    clearDataOnExit();
    return { success: true, message: "All data cleared successfully" };
  } catch (error) {
    console.error("Error during manual data clearing:", error);
    return { success: false, message: error.message };
  }
});

// Get current clear on exit setting
ipcMain.handle("get-clear-on-exit-status", () => {
  return settings.clearOnExit || false;
});

// Set clear on exit setting
ipcMain.handle("set-clear-on-exit", (event, enabled) => {
  settings.clearOnExit = enabled;
  store.set("clearOnExit", enabled);
  console.log("Clear on exit setting updated:", enabled);
  return true;
});
