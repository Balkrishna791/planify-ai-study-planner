export const NotificationService = {
  requestPermission: async () => {
    if (!("Notification" in window)) return false;
    const permission = await Notification.requestPermission();
    return permission === "granted";
  },

  send: (title, body) => {
    if (Notification.permission === "granted") {
      new Notification(title, {
        body,
        icon: "/logo192.png", // Browser icon link
      });
    }
  }
};
