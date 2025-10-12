export default function EmergencyCoverageModal({ 
  isOpen, 
  emergencyOptions, 
  selectedDonorChoices, 
  setSelectedDonorChoices, 
  caregiverName, 
  onExecute, 
  onCancel 
}) {
  if (!isOpen) return null;

  return (
    <div className="popup-overlay">
      <div className="emergency-modal">
        <div className="modal-header">
          <h3>🚨 Emergency Coverage Required</h3>
          <p>The following houses have no caregivers present on {emergencyOptions[0]?.dayName} ({emergencyOptions[0]?.targetDateStr})</p>
        </div>
        
        <div className="modal-body">
          {emergencyOptions.map((option, index) => (
            <div key={`${option.emergencyHouse}_${option.emergencyShift}`} className="emergency-option">
              <div className="emergency-info">
                <strong>{option.emergencyHouse} - {option.emergencyShift} Shift</strong>
                <span className="absent-count">({option.totalAbsent} caregiver{option.totalAbsent > 1 ? 's' : ''} absent)</span>
              </div>
              
              {option.availableDonorHouses.length > 0 ? (
                <div className="donor-selection">
                  <label>Select donor house and caregiver:</label>
                  <select 
                    value={`${selectedDonorChoices[`${option.emergencyHouse}_${option.emergencyShift}`]?.donorHouse}_${selectedDonorChoices[`${option.emergencyHouse}_${option.emergencyShift}`]?.caregiverId}` || ''}
                    onChange={(e) => {
                      const [donorHouse, caregiverId] = e.target.value.split('_');
                      if (donorHouse && caregiverId) {
                        setSelectedDonorChoices(prev => ({
                          ...prev,
                          [`${option.emergencyHouse}_${option.emergencyShift}`]: {
                            donorHouse,
                            caregiverId
                          }
                        }));
                      }
                    }}
                    className="donor-select"
                  >
                    <option value="">Select caregiver...</option>
                    {option.availableDonorHouses.map(donor => 
                      donor.presentCaregivers.map(caregiver => (
                        <option 
                          key={`${donor.house}_${caregiver.caregiverId}`}
                          value={`${donor.house}_${caregiver.caregiverId}`}
                        >
                          {donor.house} - {caregiverName(caregiver.caregiverId)} ({donor.availableCount} available)
                        </option>
                      ))
                    )}
                  </select>
                  
                  {selectedDonorChoices[`${option.emergencyHouse}_${option.emergencyShift}`] && (
                    <div className="selected-choice">
                      ✓ Will move <strong>{caregiverName(selectedDonorChoices[`${option.emergencyHouse}_${option.emergencyShift}`].caregiverId)}</strong> from <strong>{selectedDonorChoices[`${option.emergencyHouse}_${option.emergencyShift}`].donorHouse}</strong> to cover <strong>{option.emergencyHouse}</strong>
                    </div>
                  )}
                </div>
              ) : (
                <div className="no-donors">
                  ❌ No available donors found for this shift
                </div>
              )}
            </div>
          ))}
        </div>
        
        <div className="modal-footer">
          <button 
            className="execute-emergency-btn" 
            onClick={onExecute}
            disabled={Object.keys(selectedDonorChoices).length === 0}
          >
            Execute Emergency Coverage
          </button>
          <button className="cancel-emergency-btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
