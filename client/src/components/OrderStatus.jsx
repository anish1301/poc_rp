import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useChat } from '../context/ChatContext';

// API base URL - uses environment variable or fallback to localhost
const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5001';

const OrderStatus = () => {
  const { getOrderDetails, orderStatus, seedTestOrders, userId, updateOrderStatus } = useChat();
  const [orderDetails, setOrderDetails] = useState({});
  const [loading, setLoading] = useState({});
  const [errors, setErrors] = useState({});
  const [seedingOrders, setSeedingOrders] = useState(false);

  // Fetch user's existing orders on mount - prevent infinite loop with useRef
  const hasInitiallyFetched = useRef(false);
  
  // Function to fetch fresh orders from database (bypassing cache)
  const fetchFreshOrders = useCallback(async (showLoading = false) => {
    try {
      // Add cache-busting timestamp to ensure fresh data
      const timestamp = Date.now();
      console.log('🔄 Fetching fresh orders for userId:', userId);
      const response = await fetch(`${API_BASE_URL}/api/orders/user/${userId}?limit=10&fresh=true&t=${timestamp}`);
      console.log('📡 Response status:', response.status, response.ok);
      
      if (response.ok) {
        const data = await response.json();
        console.log('📦 Fresh user orders response:', data);
        console.log('📋 Fresh user orders from database:', data.orders);
        
        // Add fresh orders to tracking and update the orderStatus
        if (data.orders && data.orders.length > 0) {
          console.log('Processing', data.orders.length, 'fresh orders');
          
          // Build the new order details object
          const newOrderDetails = {};
          
          data.orders.forEach(order => {
            console.log('Processing fresh order:', {
              orderId: order.orderId, 
              status: order.status,
              totalAmount: order.totalAmount,
              items: order.items
            });
            
            // Update the order status in the chat context
            if (updateOrderStatus) {
              updateOrderStatus(order.orderId, order.status);
            }
            
            // Build the fresh order details
            newOrderDetails[order.orderId] = {
              orderData: {
                orderId: order.orderId,
                totalAmount: order.totalAmount,
                orderDate: order.orderDate,
                items: order.items,
                shippingAddress: order.shippingAddress,
                status: order.status,
                customerName: order.customerName,
                customerEmail: order.customerEmail
              },
              cancellationEligible: ['pending', 'confirmed', 'processing'].includes(order.status),
              currentStatus: order.status,
              lastFetched: Date.now(),
              metadata: {
                fromCache: false,
                responseTime: 0,
                fresh: true
              }
            };
          });
          
          // Set all order details at once
          console.log('💾 Setting fresh order details for orderIds:', Object.keys(newOrderDetails));
          console.log('💾 Fresh order details data:', newOrderDetails);
          setOrderDetails(newOrderDetails);
        } else {
          console.log('No fresh orders found');
          // Clear order details if no orders found
          setOrderDetails({});
        }
      } else {
        console.error('Failed to fetch fresh user orders:', response.status, response.statusText);
      }
    } catch (error) {
      console.error('Error fetching fresh user orders:', error);
    }
  }, [userId, updateOrderStatus]);
  
  useEffect(() => {
    const initializeFreshOrders = async () => {
      if (hasInitiallyFetched.current) return; // Prevent multiple fetches
      hasInitiallyFetched.current = true;
      
      if (userId) {
        await fetchFreshOrders(false); // Initial load without showing refresh spinner
      }
    };

    initializeFreshOrders();
  }, [userId, fetchFreshOrders]);

  // Handle seeding test orders
  const handleSeedOrders = async () => {
    setSeedingOrders(true);
    try {
      await seedTestOrders();
    } catch (error) {
      console.error('Error seeding orders:', error);
    } finally {
      setSeedingOrders(false);
    }
  };

  // Add a single test order directly to database
  const addTestOrder = async () => {
    setSeedingOrders(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/orders/add-test-order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          customerId: 'CUST-001'
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log('Test order added:', data);
        
        // Refresh the orders list to show the new order
        await fetchFreshOrders(false);
      } else {
        console.error('Failed to add test order:', response.status);
      }
    } catch (error) {
      console.error('Error adding test order:', error);
    } finally {
      setSeedingOrders(false);
    }
  };

  // Memoize the fetch function to prevent unnecessary re-renders
  const activeRequests = useRef(new Set());

  const fetchOrderDetails = useCallback(async (orderId, currentStatus) => {
    // Prevent duplicate requests using a ref instead of state
    if (activeRequests.current.has(orderId)) return;
    
    activeRequests.current.add(orderId);
    setLoading(prev => ({ ...prev, [orderId]: true }));
    
    try {
      const details = await getOrderDetails(orderId);
      if (details) {
        setOrderDetails(prev => ({ 
          ...prev, 
          [orderId]: {
            ...details,
            currentStatus: currentStatus, // Track current status
            lastFetched: Date.now()
          }
        }));
        setErrors(prev => ({ ...prev, [orderId]: null }));
      }
    } catch (error) {
      console.error(`Error fetching details for order ${orderId}:`, error);
      setErrors(prev => ({ 
        ...prev, 
        [orderId]: error.message || 'Failed to fetch order details' 
      }));
    } finally {
      activeRequests.current.delete(orderId);
      setLoading(prev => ({ ...prev, [orderId]: false }));
    }
  }, [getOrderDetails]); // Remove loading dependency

  // Fetch order details when order status changes
  const hasProcessedOrderIds = useRef(new Set());

  useEffect(() => {
    const fetchAllOrderDetails = async () => {
      const currentOrderIds = Object.keys(orderStatus);
      
      // Only process order IDs that haven't been processed yet
      for (const orderId of currentOrderIds) {
        const status = orderStatus[orderId];
        const processKey = `${orderId}-${status}`;
        
        if (!hasProcessedOrderIds.current.has(processKey)) {
          hasProcessedOrderIds.current.add(processKey);
          await fetchOrderDetails(orderId, status);
        }
      }
    };

    if (Object.keys(orderStatus).length > 0) {
      fetchAllOrderDetails();
    }
  }, [orderStatus, fetchOrderDetails]); // Only depend on orderStatus changes

  // Clean up details for orders that are no longer in orderStatus
  useEffect(() => {
    const currentOrderIds = Object.keys(orderStatus);
    const detailsOrderIds = Object.keys(orderDetails);
    
    // Remove details for orders that are no longer being tracked
    const orderIdsToRemove = detailsOrderIds.filter(id => !currentOrderIds.includes(id));
    
    if (orderIdsToRemove.length > 0) {
      setOrderDetails(prev => {
        const newDetails = { ...prev };
        orderIdsToRemove.forEach(id => delete newDetails[id]);
        return newDetails;
      });
      
      setLoading(prev => {
        const newLoading = { ...prev };
        orderIdsToRemove.forEach(id => delete newLoading[id]);
        return newLoading;
      });
      
      setErrors(prev => {
        const newErrors = { ...prev };
        orderIdsToRemove.forEach(id => delete newErrors[id]);
        return newErrors;
      });
    }
  }, [orderStatus, orderDetails]);

  // ...existing code...
  const getStatusColor = (status) => {
    const colors = {
      pending: '#ffc107',
      confirmed: '#28a745',
      processing: '#17a2b8',
      shipped: '#6f42c1',
      delivered: '#20c997',
      cancelled: '#dc3545',
      refunded: '#fd7e14',
      pending_cancellation: '#ffc107'
    };
    return colors[status] || '#6c757d';
  };

  const getStatusIcon = (status) => {
    const icons = {
      pending: '⏳',
      confirmed: '✅',
      processing: '🔄',
      shipped: '🚚',
      delivered: '📦',
      cancelled: '❌',
      refunded: '💰',
      pending_cancellation: '⏸️'
    };
    return icons[status] || '📋';
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (Object.keys(orderStatus).length === 0 && Object.keys(orderDetails).length === 0) {
    return (
      <div className="order-status-container">
        <h3>🛒 Order Tracking</h3>
        <div className="no-orders">
          <div className="no-orders-content">
            <div className="no-orders-icon">📦</div>
            <h4>No Orders Yet</h4>
            <p>Order details will appear here when you start a conversation about your orders.</p>
            
            <button 
              onClick={handleSeedOrders} 
              disabled={seedingOrders}
              className="seed-orders-btn"
            >
              {seedingOrders ? '⏳ Creating...' : '🎯 Create Test Orders'}
            </button>
            
            <div className="sample-queries">
              <small>Try asking:</small>
              <ul>
                <li>"What's the status of my order ORD-2024-001?"</li>
                <li>"I want to cancel order ORD789"</li>
                <li>"Track my order ORD-2024-002"</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Get all orders (from orderStatus and orderDetails)
  const allOrderIds = Array.from(new Set([
    ...Object.keys(orderStatus),
    ...Object.keys(orderDetails)
  ]));

  return (
    <div className="order-status-container">
      <h3 style={{ marginBottom: '20px' }}>🛒 Order Tracking</h3>
      
      {/* Test Status Updates Section */}
      <div className="test-section" style={{ 
        background: '#f8f9fa', 
        padding: '15px', 
        borderRadius: '8px', 
        marginBottom: '20px',
        border: '1px solid #e9ecef'
      }}>
        <h4 style={{ marginBottom: '10px', color: '#495057' }}>🧪 Test Orders</h4>
        <p style={{ fontSize: '14px', color: '#6c757d', marginBottom: '15px' }}>
          Add test orders to see how the system works:
        </p>
        
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button 
            onClick={addTestOrder}
            disabled={seedingOrders}
            style={{ 
              background: seedingOrders ? '#6c757d' : '#ffc107', 
              color: 'white', 
              border: 'none', 
              padding: '8px 16px', 
              borderRadius: '4px', 
              cursor: seedingOrders ? 'not-allowed' : 'pointer' 
            }}
          >
            {seedingOrders ? '⏳ Adding...' : '➕ Add Test Order'}
          </button>
        </div>
      </div>
      
      <div className="orders-list">
        {allOrderIds.map((orderId) => {
          const status = orderStatus[orderId] || orderDetails[orderId]?.currentStatus || 'unknown';
          const details = orderDetails[orderId];
          const isLoading = loading[orderId];
          const error = errors[orderId];

          return (
            <div key={orderId} className="order-card">
              {/* Order Header */}
              <div className="order-header">
                <div className="order-id">
                  <strong>Order {orderId}</strong>
                </div>
                <div 
                  className="order-status-badge"
                  style={{ 
                    backgroundColor: getStatusColor(status),
                    color: 'white'
                  }}
                >
                  {getStatusIcon(status)} {status.replace('_', ' ').toUpperCase()}
                </div>
              </div>

              {/* Status Change Indicator */}
              {details && details.currentStatus !== status && (
                <div className="status-change-indicator">
                  <span className="status-update-badge">
                    🔄 Status updated: {details.currentStatus} → {status}
                  </span>
                </div>
              )}

              {/* Loading State */}
              {isLoading && (
                <div className="order-loading">
                  <div className="loading-spinner"></div>
                  <span>Loading order details...</span>
                </div>
              )}

              {/* Error State */}
              {error && (
                <div className="order-error">
                  <span>⚠️ {error}</span>
                  <button 
                    onClick={() => fetchOrderDetails(orderId, status)}
                    className="retry-button"
                  >
                    Retry
                  </button>
                </div>
              )}

              {/* Order Details */}
              {details && !isLoading && !error && (
                <div className="order-details">
                  {/* Order Summary */}
                  <div className="order-summary">
                    <div className="summary-item">
                      <span className="label">Total Amount:</span>
                      <span className="value">
                        {formatCurrency(details.orderData?.totalAmount || 0)}
                      </span>
                    </div>
                    <div className="summary-item">
                      <span className="label">Order Date:</span>
                      <span className="value">
                        {formatDate(details.orderData?.orderDate)}
                      </span>
                    </div>
                    <div className="summary-item">
                      <span className="label">Items:</span>
                      <span className="value">
                        {details.orderData?.items?.length || 0} item(s)
                      </span>
                    </div>
                  </div>

                  {/* Items List */}
                  {details.orderData?.items && details.orderData.items.length > 0 && (
                    <div className="order-items">
                      <h4>Items:</h4>
                      <ul>
                        {details.orderData.items.map((item, index) => (
                          <li key={index} className="order-item">
                            <span className="item-name">{item.name}</span>
                            <span className="item-details">
                              Qty: {item.quantity} × {formatCurrency(item.price)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Shipping Information */}
                  {details.orderData?.shippingAddress && (
                    <div className="shipping-info">
                      <h4>Shipping Address:</h4>
                      <div className="address">
                        {details.orderData.shippingAddress.street}<br />
                        {details.orderData.shippingAddress.city}, {details.orderData.shippingAddress.state} {details.orderData.shippingAddress.zipCode}<br />
                        {details.orderData.shippingAddress.country}
                      </div>
                    </div>
                  )}

                  {/* Cancellation Status */}
                  <div className="cancellation-info">
                    <div className="cancellation-status">
                      <span className="label">Cancellation Eligible:</span>
                      <span className={`value ${details.cancellationEligible ? 'eligible' : 'not-eligible'}`}>
                        {details.cancellationEligible ? '✅ Yes' : '❌ No'}
                      </span>
                    </div>
                    
                    {!details.cancellationEligible && (
                      <div className="cancellation-reason">
                        <small>
                          {status === 'shipped' 
                            ? 'Order has been shipped - contact customer service for returns'
                            : status === 'delivered'
                            ? 'Order has been delivered - contact customer service for returns'
                            : status === 'cancelled'
                            ? 'Order is already cancelled'
                            : 'Order cannot be cancelled at this time'
                          }
                        </small>
                      </div>
                    )}
                  </div>

                  {/* Cache Information */}
                  {details.metadata && (
                    <div className="cache-info">
                      <small>
                        {details.metadata.fromCache && '💾 From cache'} 
                        {details.metadata.responseTime && ` • ${details.metadata.responseTime}ms`}
                        {details.metadata.cacheHits > 0 && ` • ${details.metadata.cacheHits} cache hits`}
                      </small>
                    </div>
                  )}

                  {/* Last Updated */}
                  <div className="last-updated">
                    <small>
                      Last updated: {formatDate(details.lastFetched)}
                    </small>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default OrderStatus;