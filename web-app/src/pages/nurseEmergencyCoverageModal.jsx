import { useState, useEffect } from 'react';

export default function NurseEmergencyCoverageModal({ 
  isOpen, 
  emergencyOptions, 
  selectedDonorChoices, 
  setSelectedDonorChoices, 
  nurseName, 
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
      const firstEmergency = `${emergencyOptions[0].emergencyShift}`;
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
            Emergency Coverage Required - Nurses
          </h3>
        </div>
        
        <div className="header-info">
          <div className="info-row">
            <span className="info-label">Coverage Across:</span>
            <span className="info-value">
              {(() => {
                const uniqueDates = [...new Set(emergencyOptions.map(o => o.targetDateStr))];
                if (uniqueDates.length === 1) {
                  return `${emergencyOptions[0]?.dayName} (${emergencyOptions[0]?.targetDateStr})`;
                } else {
                  return `${uniqueDates.length} different dates`;
                }
              })()}
            </span>
          </div>
          <div className="info-row">
            <span className="info-label">Emergencies:</span>
            <span className="info-value emergency-count">{emergencyOptions.length} shift{emergencyOptions.length > 1 ? 's' : ''} with zero coverage</span>
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
              {emergencyOptions.map((option, index) => {
                // Create unique key combining date and shift
                const uniqueKey = `${option.targetDateStr}_${option.emergencyShift}`;
                return (
                  <div 
                    key={uniqueKey} 
                    className={`emergency-item ${selectedEmergency === uniqueKey ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedEmergency(uniqueKey);
                      // Clear previous donor choice when switching emergencies
                      setSelectedDonorChoices({});
                    }}
                    style={{ 
                      cursor: 'pointer', 
                      border: selectedEmergency === uniqueKey ? '2px solid #dc3545' : '1px solid #ddd',
                      padding: '12px',
                      marginBottom: '8px',
                      borderRadius: '8px',
                      backgroundColor: selectedEmergency === uniqueKey ? '#fff5f5' : '#f9f9f9'
                    }}
                  >
                    <div className="emergency-info">
                      <strong style={{ color: '#dc3545', fontSize: '15px' }}>
                        {selectedEmergency === uniqueKey ? '✓ ' : ''}
                        {option.dayName} ({option.targetDateStr}) - {option.emergencyShift} Shift
                      </strong>
                      <span className="absent-count" style={{ marginLeft: '8px', color: '#666', fontSize: '13px' }}>
                        ({option.totalAbsent} nurse{option.totalAbsent > 1 ? 's' : ''} absent)
                      </span>
                    </div>
                  </div>
                );
              })}
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
              opt => `${opt.targetDateStr}_${opt.emergencyShift}` === selectedEmergency
            );
            
            if (!selectedOption) return null;
            
            return (
              <div className="donor-assignment" style={{ marginTop: '20px', borderTop: '1px solid #ddd', paddingTop: '20px' }}>
                <h4 style={{ color: '#333', fontSize: '16px', marginBottom: '12px' }}>
                  Assign Donor Nurse for {selectedOption.dayName} ({selectedOption.targetDateStr}) - {selectedOption.emergencyShift} Shift:
                </h4>
                
                {selectedOption.availableDonorShifts && selectedOption.availableDonorShifts.length > 0 ? (
                  <div className="donor-selection">
                    <label style={{ fontWeight: '500', marginBottom: '8px', display: 'block', color: '#555', fontSize: '14px' }}>
                      Select donor shift and nurse:
                    </label>
                    <select 
                      value={`${selectedDonorChoices[selectedEmergency]?.donorShift}_${selectedDonorChoices[selectedEmergency]?.nurseId}` || ''}
                      onChange={(e) => {
                        const [donorShift, nurseId] = e.target.value.split('_');
                        if (donorShift && nurseId) {
                          setSelectedDonorChoices({
                            [selectedEmergency]: {
                              donorShift,
                              nurseId,
                              targetDateStr: selectedOption.targetDateStr,
                              emergencyShift: selectedOption.emergencyShift
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
                      <option value="">Select nurse...</option>
                      {selectedOption.availableDonorShifts.map(donor => 
                        donor.presentNurses.map(nurse => (
                          <option 
                            key={`${donor.shift}_${nurse.nurseId}`}
                            value={`${donor.shift}_${nurse.nurseId}`}
                          >
                            {donor.shift} Shift - {nurseName(nurse.nurseId)} ({donor.availableCount} available)
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
                          Will move <strong>{nurseName(selectedDonorChoices[selectedEmergency].nurseId)}</strong> from <strong>{selectedDonorChoices[selectedEmergency].donorShift}</strong> to cover <strong>{selectedOption.emergencyShift}</strong>
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
