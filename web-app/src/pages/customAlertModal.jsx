export default function CustomAlertModal({ 
  isOpen, 
  onClose, 
  title, 
  message 
}) {
  if (!isOpen) return null;

  return (
    <div className="popup-overlay">
      <div className="popup-content custom-alert">
        <div className="popup-title">
          {title}
        </div>
        <div className="alert-message">
          {message}
        </div>
        <div className="popup-buttons">
          <button className="popup-btn ok-btn" onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
