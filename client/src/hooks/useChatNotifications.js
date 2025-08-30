import { useNotification } from '../context/NotificationContext';

// Custom hook to handle chat notifications
export const useChatNotifications = () => {
  const { showSuccess, showError, showInfo, showWarning } = useNotification();

  const handleOrderCancelled = (orderData) => {
    showSuccess(
      `✅ Order Cancelled!\n\nYour order has been successfully cancelled. You will receive a refund within 3-5 business days.`,
      6000
    );
  };

  const handleOrderStatusUpdate = (orderData) => {
    const statusMessages = {
      'shipped': `📦 Order Shipped!\n\nYour order is now on its way to you. Track your package for updates.`,
      'delivered': `✅ Order Delivered!\n\nYour order has been delivered successfully. Enjoy your purchase!`,
      'processing': `⚙️ Order Processing\n\nYour order is being prepared for shipment.`,
      'confirmed': `✅ Order Confirmed!\n\nYour order has been confirmed and will be processed soon.`
    };

    const message = statusMessages[orderData.status] || `📋 Status Update\n\nYour order status has been updated to: ${orderData.status}`;
    
    if (orderData.status === 'delivered') {
      showSuccess(message, 7000);
    } else if (orderData.status === 'shipped') {
      showInfo(message, 6000);
    } else {
      showInfo(message, 5000);
    }
  };

  const handleConnectionStatus = (isConnected) => {
    if (isConnected) {
      showSuccess('🔗 Connected to server', 3000);
    } else {
      showWarning('⚠️ Connection lost. Trying to reconnect...', 5000);
    }
  };

  const handleError = (error) => {
    showError(`❌ Error\n\n${error}`, 6000);
  };

  const handleMessageSent = (cached = false) => {
    if (cached) {
      showInfo('⚡ Response from cache', 2000);
    }
  };

  const handleRefundProcessed = (orderData) => {
    showSuccess(
      `💰 Refund Processed!\n\nYour refund of $${orderData.amount} has been processed and will appear in your account within 3-5 business days.`,
      7000
    );
  };

  return {
    handleOrderCancelled,
    handleOrderStatusUpdate,
    handleConnectionStatus,
    handleError,
    handleMessageSent,
    handleRefundProcessed
  };
};

export default useChatNotifications;
