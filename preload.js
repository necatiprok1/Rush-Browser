const { contextBridge, ipcRenderer } = require("electron");

// Ana süreç ile güvenli iletişim için API'yi tanımlama
contextBridge.exposeInMainWorld("electronAPI", {
  // Navigasyon
  navigateTo: (url) => ipcRenderer.invoke("navigate-to", url),
  goBack: () => ipcRenderer.invoke("go-back"),
  goForward: () => ipcRenderer.invoke("go-forward"),
  refresh: () => ipcRenderer.invoke("refresh"),
  goHome: () => ipcRenderer.invoke("go-home"),

  // Zoom kontrolü
  getZoomFactor: () => ipcRenderer.invoke("get-zoom-factor"),
  setZoomFactor: (factor) => ipcRenderer.invoke("set-zoom-factor", factor),
  zoomIn: () => ipcRenderer.invoke("zoom-in"),
  zoomOut: () => ipcRenderer.invoke("zoom-out"),
  onZoomChange: (callback) =>
    ipcRenderer.on("zoom-change", (_, factor) => callback(factor)),

  // Tema yönetimi
  toggleDarkMode: (enabled) => ipcRenderer.invoke("toggle-dark-mode", enabled),
  isDarkMode: () => ipcRenderer.invoke("is-dark-mode"),
  onThemeChange: (callback) => {
    ipcRenderer.on("theme-changed", (_, isDarkMode) => callback(isDarkMode));
  },

  // Font size yönetimi
  setFontSize: (fontSize) => ipcRenderer.invoke("set-font-size", fontSize),
  getFontSize: () => ipcRenderer.invoke("get-font-size"),
  onFontSizeChange: (callback) => {
    ipcRenderer.on("font-size-changed", (_, fontSize) => callback(fontSize));
  },

  // Sekme yönetimi
  newTab: (url) => ipcRenderer.invoke("new-tab", url),
  switchTab: (viewId) => ipcRenderer.invoke("switch-tab", viewId),
  closeTab: (viewId) => ipcRenderer.invoke("close-tab", viewId),
  reorderTabs: (newOrder) => ipcRenderer.invoke("reorder-tabs", newOrder),
  getCurrentUrl: () => ipcRenderer.invoke("get-current-url"),
  getCurrentTitle: () => ipcRenderer.invoke("get-current-title"),

  // Ayarlar
  openSettings: () => ipcRenderer.invoke("open-settings"),
  closeWindow: () => ipcRenderer.invoke("close-window"),
  getSettings: () => ipcRenderer.invoke("get-settings"),
  saveSettings: (settings) => ipcRenderer.invoke("save-settings", settings),
  clearAllDataNow: () => ipcRenderer.invoke("clear-all-data-now"),
  getClearOnExitStatus: () => ipcRenderer.invoke("get-clear-on-exit-status"),
  setClearOnExit: (enabled) => ipcRenderer.invoke("set-clear-on-exit", enabled),

  // Yer imleri
  getBookmarks: () => ipcRenderer.invoke("get-bookmarks"),
  addBookmark: (bookmark) => ipcRenderer.invoke("add-bookmark", bookmark),
  removeBookmark: (url) => ipcRenderer.invoke("remove-bookmark", url),
  isBookmarked: (url) => ipcRenderer.invoke("is-bookmarked", url),

  // Olay dinleyicileri
  onUrlUpdate: (callback) => {
    const handler = (_, url) => callback(url);
    ipcRenderer.on("url-update", handler);
    return () => ipcRenderer.removeListener("url-update", handler);
  },
  onLoadingStarted: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("loading-started", handler);
    return () => ipcRenderer.removeListener("loading-started", handler);
  },
  onLoadingStopped: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("loading-stopped", handler);
    return () => ipcRenderer.removeListener("loading-stopped", handler);
  },
  onTitleUpdate: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on("title-update", handler);
    return () => ipcRenderer.removeListener("title-update", handler);
  },
  onTabUpdate: (callback) =>
    ipcRenderer.on("tab-update", (_, tab) => callback(tab)),
  onTabClosed: (callback) =>
    ipcRenderer.on("tab-closed", (_, tabId) => callback(tabId)),
  onTabTitleUpdated: (callback) =>
    ipcRenderer.on("tab-title-updated", (_, data) => callback(data)),

  // Ayarlar için özel metod
  openSettingsTab: (section) =>
    ipcRenderer.invoke("openSettingsTab", section),
  openDownloadsTab: () =>
    ipcRenderer.invoke("open-downloads-tab"),

  // Diğer işlevler buraya eklenebilir
  googleSignOut: () => ipcRenderer.invoke("google-sign-out"),
  getGoogleUserInfo: () => ipcRenderer.invoke("get-google-user-info"),

  // URL açma
  openUrl: (url) => ipcRenderer.invoke("open-url", url),
  
  // Quick Search Overlay
  showQuickSearch: () => ipcRenderer.invoke("show-quick-search"),
  hideQuickSearch: () => ipcRenderer.invoke("hide-quick-search"),
  performOverlaySearch: (query) => ipcRenderer.invoke("perform-overlay-search", query),
  
  // Developer Tools
  toggleDevTools: (isOpen) => ipcRenderer.invoke("toggle-dev-tools", isOpen),
  executeJavaScript: (code) => ipcRenderer.invoke("execute-javascript", code),
  getPageSource: () => ipcRenderer.invoke("get-page-source"),
  getConsoleMessages: () => ipcRenderer.invoke("get-console-messages"),
  clearConsoleMessages: () => ipcRenderer.invoke("clear-console-messages"),
  onConsoleMessage: (callback) => {
    const handler = (_, message) => callback(message);
    ipcRenderer.on("console-message", handler);
    return () => ipcRenderer.removeListener("console-message", handler);
  },

  // Image copy notifications
  onImageCopied: (callback) => {
    const handler = (_, result) => callback(result);
    ipcRenderer.on("image-copied", handler);
    return () => ipcRenderer.removeListener("image-copied", handler);
  },
  onImageAddressCopied: (callback) => {
    const handler = (_, result) => callback(result);
    ipcRenderer.on("image-address-copied", handler);
    return () => ipcRenderer.removeListener("image-address-copied", handler);
  },
  onLinkCopied: (callback) => {
    const handler = (_, result) => callback(result);
    ipcRenderer.on("link-copied", handler);
    return () => ipcRenderer.removeListener("link-copied", handler);
  },
  onImageSaved: (callback) => {
    const handler = (_, result) => callback(result);
    ipcRenderer.on("image-saved", handler);
    return () => ipcRenderer.removeListener("image-saved", handler);
  },

  // Downloads management
  getDownloads: () => ipcRenderer.invoke("get-downloads"),
  clearCompletedDownloads: () => ipcRenderer.invoke("clear-completed-downloads"),
  removeDownload: (downloadId) => ipcRenderer.invoke("remove-download", downloadId),
  openDownloadFolder: () => ipcRenderer.invoke("open-download-folder"),
  openFile: (filePath) => ipcRenderer.invoke("open-file", filePath),
  showInFolder: (filePath) => ipcRenderer.invoke("show-in-folder", filePath),
  onDownloadUpdate: (callback) => {
    const handler = (_, downloads) => callback(downloads);
    ipcRenderer.on("download-update", handler);
    return () => ipcRenderer.removeListener("download-update", handler);
  },
  onDownloadStarted: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on("download-started", handler);
    return () => ipcRenderer.removeListener("download-started", handler);
  },
  onDownloadCompleted: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on("download-completed", handler);
    return () => ipcRenderer.removeListener("download-completed", handler);
  },
  onDownloadFailed: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on("download-failed", handler);
    return () => ipcRenderer.removeListener("download-failed", handler);
  },
});
