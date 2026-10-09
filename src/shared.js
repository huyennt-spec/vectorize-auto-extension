// Dùng chung cho content script, background và popup.
globalThis.VA = {
  DEFAULTS: {
    enabled: true,      // Bật/tắt toàn bộ extension
    autoPrecrop: true,  // Tự bấm OK ở bảng Pre-Crop
    autoDownload: true, // Tự bấm DOWNLOAD khi có kết quả
  },
};
