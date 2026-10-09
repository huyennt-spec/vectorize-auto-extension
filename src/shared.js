// Dùng chung cho content script, background và popup.
globalThis.VA = {
  DEFAULTS: {
    enabled: true,      // Bật/tắt toàn bộ extension
    autoPrecrop: true,  // Tự bấm OK ở bảng Pre-Crop
    autoDownload: true, // Tự bấm DOWNLOAD khi có kết quả
    autoReturn: true,   // Tải xong tự quay về trang chính để kéo ảnh tiếp
    showToast: true,    // Hiện thông báo nhỏ góc dưới trang
  },
};
