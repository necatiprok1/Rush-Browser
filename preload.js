const { contextBridge, ipcRenderer } = require('electron');

// Ana süreç ile güvenli iletişim için API'yi tanımlama
contextBridge.exposeInMainWorld('electronAPI', {
  // Navigasyon
  navigateTo: (url) => ipcRenderer.invoke('navigate-to', url),
  goBack: () => ipcRenderer.invoke('go-back'),
  goForward: () => ipcRenderer.invoke('go-forward'),
  refresh: () => ipcRenderer.invoke('refresh'),
  goHome: () => ipcRenderer.invoke('go-home'),
  
  // Zoom kontrolü
  getZoomFactor: () => ipcRenderer.invoke('get-zoom-factor'),
  setZoomFactor: (factor) => ipcRenderer.invoke('set-zoom-factor', factor),
  zoomIn: () => ipcRenderer.invoke('zoom-in'),
  zoomOut: () => ipcRenderer.invoke('zoom-out'),
  onZoomChange: (callback) => ipcRenderer.on('zoom-change', (_, factor) => callback(factor)),
  
  // Tema yönetimi
  toggleDarkMode: (enabled) => ipcRenderer.invoke('toggle-dark-mode', enabled),
  isDarkMode: () => ipcRenderer.invoke('is-dark-mode'),
  
  // Sekme yönetimi
  newTab: (url) => ipcRenderer.invoke('new-tab', url),
  switchTab: (viewId) => ipcRenderer.invoke('switch-tab', viewId),
  closeTab: (viewId) => ipcRenderer.invoke('close-tab', viewId),
  getCurrentUrl: () => ipcRenderer.invoke('get-current-url'),
  getCurrentTitle: () => ipcRenderer.invoke('get-current-title'),
  
  // Ayarlar
  openSettings: () => ipcRenderer.invoke('open-settings'),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  
  // Yer imleri
  getBookmarks: () => ipcRenderer.invoke('get-bookmarks'),
  addBookmark: (bookmark) => ipcRenderer.invoke('add-bookmark', bookmark),
  removeBookmark: (url) => ipcRenderer.invoke('remove-bookmark', url),
  isBookmarked: (url) => ipcRenderer.invoke('is-bookmarked', url),
  
  // Olay dinleyicileri
  onUrlUpdate: (callback) => {
    const handler = (_, url) => callback(url);
    ipcRenderer.on('url-update', handler);
    return () => ipcRenderer.removeListener('url-update', handler);
  },
  onTabUpdate: (callback) => ipcRenderer.on('tab-update', (_, tab) => callback(tab)),
  onTabClosed: (callback) => ipcRenderer.on('tab-closed', (_, tabId) => callback(tabId))
});