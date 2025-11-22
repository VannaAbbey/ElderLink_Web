import { useState, useEffect } from 'react';

export default function EmergencyCoverageModal({ 
  isOpen, 
  emergencyOptions, 
  selectedDonorChoices, 
  setSelectedDonorChoices, 
  caregiverName, 
  onExecute, 
  onCancel 
}) {
  const [selectedEmergency, setSelectedEmergency] = useState(null);

  // Helper function to get current shift
  const getCurrentShift = () => {
    const now = new Date();
    const hours = now.getHours();
    
    if (hours >= 6 && hours < 14) {
      return "1st";
    } else if (hours >= 14 && hours < 22) {
      return "2nd";
    } else {
      return "3rd";
    }
  };

  // Reset selected emergency when modal opens/closes or options change
  useEffect(() => {
    if (isOpen && emergencyOptions.length > 0) {
      // Auto-select first emergency when modal opens
      const firstEmergency = `${emergencyOptions[0].emergencyHouse}_${emergencyOptions[0].emergencyShift}`;
      setSelectedEmergency(firstEmergency);
    } else {
      setSelectedEmergency(null);
    }
  }, [isOpen, emergencyOptions]);

  if (!isOpen) return null;

  // Check if showing today's emergencies
  const today = new Date().toISOString().slice(0, 10);
  const isToday = emergencyOptions[0]?.targetDateStr === today;
  const currentShift = getCurrentShift();

  return (
    <div className="popup-overlay">
      <div className="emergency-modal">
        <div className="modal-header">
          <div className="header-icon">
            🚨
          </div>
          <h3 className="header-title">
            Emergency Coverage Required
          </h3>
        </div>
        
        <div className="header-info">
          <div className="info-row">
            <span className="info-label">Date:</span>
            <span className="info-value">{emergencyOptions[0]?.dayName} ({emergencyOptions[0]?.targetDateStr})</span>
          </div>
          <div className="info-row">
            <span className="info-label">Emergencies:</span>
            <span className="info-value emergency-count">{emergencyOptions.length} house/shift{emergencyOptions.length > 1 ? 's' : ''} with zero coverage</span>
          </div>
          {isToday && (
            <div className="info-row shift-notice">
              <span className="notice-icon">⏰</span>
              <span className="notice-text">Showing current shift ({currentShift}) and future shifts only</span>
            </div>
          )}
        </div>
        
        <div className="modal-body">
          {/* Emergency Selection */}
          <div className="emergency-selection">
            <h4 style={{ color: '#333', fontSize: '16px', marginBottom: '12px' }}>
              Select Emergency to Resolve: (One at a time)
            </h4>
            <div className="emergency-list">
              {emergencyOptions.map((option, index) => (
                <div 
                  key={`${option.emergencyHouse}_${option.emergencyShift}`} 
                  className={`emergency-item ${selectedEmergency === `${option.emergencyHouse}_${option.emergencyShift}` ? 'selected' : ''}`}
                  onClick={() => {
                    setSelectedEmergency(`${option.emergencyHouse}_${option.emergencyShift}`);
                    // Clear previous donor choice when switching emergencies
                    setSelectedDonorChoices({});
                  }}
                  style={{ 
                    cursor: 'pointer', 
                    border: selectedEmergency === `${option.emergencyHouse}_${option.emergencyShift}` ? '2px solid #dc3545' : '1px solid #ddd',
                    padding: '12px',
                    marginBottom: '8px',
                    borderRadius: '8px',
                    backgroundColor: selectedEmergency === `${option.emergencyHouse}_${option.emergencyShift}` ? '#fff5f5' : '#f9f9f9'
                  }}
                >
                  <div className="emergency-info">
                    <strong style={{ color: '#dc3545', fontSize: '15px' }}>
                      {selectedEmergency === `${option.emergencyHouse}_${option.emergencyShift}` ? '✓ ' : ''}
                      {option.emergencyHouse} - {option.emergencyShift} Shift
                    </strong>
                    <span className="absent-count" style={{ marginLeft: '8px', color: '#666', fontSize: '13px' }}>
                      ({option.totalAbsent} caregiver{option.totalAbsent > 1 ? 's' : ''} absent)
                    </span>
                  </div>
                </div>
              ))}
            </div>
            {!selectedEmergency && (
              <div className="selection-reminder" style={{ marginTop: '8px' }}>
                <small style={{ color: '#dc3545', fontStyle: 'italic' }}>
                  Please click on one of the emergencies above to select it.
                </small>
              </div>
            )}
          </div>

          {/* Donor Selection for Selected Emergency */}
          {selectedEmergency && (() => {
            const selectedOption = emergencyOptions.find(
              opt => `${opt.emergencyHouse}_${opt.emergencyShift}` === selectedEmergency
            );
            
            if (!selectedOption) return null;
            
            return (
              <div className="donor-assignment" style={{ marginTop: '20px', borderTop: '1px solid #ddd', paddingTop: '20px' }}>
                <h4 style={{ color: '#333', fontSize: '16px', marginBottom: '12px' }}>
                  Assign Donor Caregiver for {selectedOption.emergencyHouse} - {selectedOption.emergencyShift} Shift:
                </h4>
                
                {selectedOption.availableDonorHouses.length > 0 ? (
                  <div className="donor-selection">
                    <label style={{ fontWeight: '500', marginBottom: '8px', display: 'block', color: '#555', fontSize: '14px' }}>
                      Select donor house and caregiver:
                    </label>
                    <select 
                      value={`${selectedDonorChoices[selectedEmergency]?.donorHouse}_${selectedDonorChoices[selectedEmergency]?.caregiverId}` || ''}
                      onChange={(e) => {
                        const [donorHouse, caregiverId] = e.target.value.split('_');
                        if (donorHouse && caregiverId) {
                          setSelectedDonorChoices({
                            [selectedEmergency]: {
                              donorHouse,
                              caregiverId
                            }
                          });
                        }
                      }}
                      className="donor-select"
                      style={{ 
                        width: '100%', 
                        padding: '10px', 
                        fontSize: '14px',
                        borderRadius: '6px',
                        border: '1px solid #ddd',
                        color: '#333'
                      }}
                    >
                      <option value="">Select caregiver...</option>
                      {selectedOption.availableDonorHouses.map(donor => 
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
                    
                    {selectedDonorChoices[selectedEmergency] && (
                      <div className="selected-choice" style={{ 
                        marginTop: '12px', 
                        padding: '12px', 
                        backgroundColor: '#d4edda', 
                        borderRadius: '6px',
                        border: '1px solid #c3e6cb'
                      }}>
                        <strong style={{ color: '#155724', fontSize: '14px' }}>✓ Assignment Preview:</strong><br/>
                        <span style={{ color: '#155724', fontSize: '13px' }}>
                          Will move <strong>{caregiverName(selectedDonorChoices[selectedEmergency].caregiverId)}</strong> from <strong>{selectedDonorChoices[selectedEmergency].donorHouse}</strong> to cover <strong>{selectedOption.emergencyHouse}</strong>
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="no-donors" style={{ 
                    padding: '12px', 
                    backgroundColor: '#f8d7da', 
                    borderRadius: '6px',
                    color: '#721c24',
                    fontSize: '14px'
                  }}>
                    ❌ No available donors found for this shift
                  </div>
                )}
              </div>
            );
          })()}
        </div>
        
        <div className="modal-footer">
          <button 
            className="execute-emergency-btn" 
            onClick={onExecute}
            disabled={!selectedEmergency || Object.keys(selectedDonorChoices).length === 0}
            style={{
              opacity: (!selectedEmergency || Object.keys(selectedDonorChoices).length === 0) ? 0.5 : 1
            }}
          >
            Execute Emergency Coverage (1 emergency)
          </button>
          <button className="cancel-emergency-btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
