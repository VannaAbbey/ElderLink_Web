export default function CustomAlertModal({ 
  isOpen, 
  onClose, 
  onConfirm,
  title, 
  message,
  type = "alert", // "alert" or "confirm"
  customClass = "" // Allow custom CSS class for special modals
}) {
  if (!isOpen) return null;

  const handleConfirm = () => {
    if (onConfirm) onConfirm();
    onClose();
  };

  return (
    <div className="popup-overlay">
      <div className={`popup-content custom-alert ${customClass}`}>
        <div className="popup-title">
          {title}
        </div>
        <div className="alert-message">
          {message}
        </div>
        <div className="popup-buttons">
          {type === "confirm" ? (
            <>
              <button className="popup-btn yes" onClick={handleConfirm}>
                Yes
              </button>
              <button className="popup-btn no" onClick={onClose}>
                No
              </button>
            </>
          ) : (
            <button className="popup-btn ok-btn" onClick={onClose}>
              OK
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
