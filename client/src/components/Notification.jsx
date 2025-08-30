import React, { useState, useEffect, useCallback } from 'react';
import './Notification.css';

const Notification = ({ 
  message, 
  type = 'success', 
  duration = 5000, 
  onClose,
  show = false 
}) => {
  const [visible, setVisible] = useState(false);
  const [animate, setAnimate] = useState(false);

  const handleClose = useCallback(() => {
    setAnimate(false);
    setTimeout(() => {
      setVisible(false);
      if (onClose) onClose();
    }, 300); // Wait for slide-out animation
  }, [onClose]);

  useEffect(() => {
    if (show && message) {
      // Start the animation sequence
      setVisible(true);
      setTimeout(() => setAnimate(true), 50); // Small delay for smoother animation

      // Auto-hide after duration
      const timer = setTimeout(() => {
        handleClose();
      }, duration);

      return () => clearTimeout(timer);
    }
  }, [show, message, duration, handleClose]);

  if (!visible) return null;

  const getIcon = () => {
    switch (type) {
      case 'success':
        return '✅';
      case 'error':
        return '❌';
      case 'warning':
        return '⚠️';
      case 'info':
        return 'ℹ️';
      default:
        return '📢';
    }
  };

  return (
    <div className={`notification notification-${type} ${animate ? 'slide-in' : 'slide-out'}`}>
      <div className="notification-content">
        <span className="notification-icon">{getIcon()}</span>
        <span className="notification-message">{message}</span>
        <button 
          className="notification-close" 
          onClick={handleClose}
          aria-label="Close notification"
        >
          ×
        </button>
      </div>
    </div>
  );
};

export default Notification;
