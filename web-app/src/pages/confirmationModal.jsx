export default function ConfirmationModal({ 
  isOpen, 
  caregiverName, 
  onConfirm, 
  onCancel 
}) {
  if (!isOpen) return null;

  return (
    <div className="popup-overlay">
      <div className="popup-content">
        <div className="popup-title">
          Are you really sure you want to mark <span className="caregiver-name">{caregiverName}</span> as absent? You can't undo this action.
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
