export default function ConfirmationModal({ 
  isOpen, 
  caregiverName, 
  onConfirm, 
  onCancel,
  message
}) {
  if (!isOpen) return null;

  return (
    <div className="popup-overlay">
      <div className="popup-content">
        <div className="popup-title">
          {message || `Are you really sure you want to mark ${caregiverName} as absent?`}
        </div>
        <div className="popup-buttons">
          <button className="popup-btn yes" onClick={onConfirm}>
            Yes
          </button>
          <button className="popup-btn no" onClick={onCancel}>
            No
          </button>
        </div>
      </div>
    </div>
  );
}
