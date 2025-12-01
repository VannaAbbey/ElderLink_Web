export default function NewCaregiverModal({ 
  isOpen, 
  unassignedCaregivers, 
  selectedNewCaregiver, 
  handleCaregiverSelection, 
  integrationMode, 
  setIntegrationMode, 
  setSelectedRecommendation, 
  systemRecommendations, 
  selectedRecommendation, 
  manualAssignment, 
  setManualAssignment, 
  houses, 
  shiftDefs, 
  daysOfWeek, 
  areWorkDaysConsecutive, 
  onExecute, 
  onCancel,
  isIntegrating
}) {
  if (!isOpen) return null;

  return (
    <>
      <div className="popup-overlay">
        <div className="integration-modal">
          <div className="integration-modal-header">
            <h3>👥 New Caregiver Integration</h3>
            <p>Integrate new caregivers into the existing schedule</p>
          </div>
        
        <div className="modal-body">
          {/* Caregiver Selection */}
          <div className="caregiver-selection">
            <h4>Select New Caregiver:</h4>
            <div className="caregiver-list">
              {unassignedCaregivers.map(caregiver => (
                <div 
                  key={caregiver.id} 
                  className={`caregiver-item ${selectedNewCaregiver === caregiver.id ? 'selected' : ''}`}
                  onClick={() => handleCaregiverSelection(caregiver.id)}
                >
                  <span className="caregiver-name">{caregiver.user_fname} {caregiver.user_lname}</span>
                </div>
              ))}
            </div>
          </div>

          {selectedNewCaregiver && (
            <>
              {/* Integration Mode Selection */}
              <div className="integration-mode">
                <h4>Assignment Method:</h4>
                <div className="mode-options">
                  <label className="mode-option">
                    <input 
                      type="radio" 
                      value="auto" 
                      checked={integrationMode === 'auto'}
                      onChange={(e) => {
                        setIntegrationMode(e.target.value);
                        setSelectedRecommendation(null);
                      }}
                    />
                    <div className="mode-option-content">
                      <span>🤖 Automatic (System Recommendation)</span>
                      <small>System analyzes current schedule and recommends optimal placement</small>
                    </div>
                  </label>
                  <label className="mode-option">
                    <input 
                      type="radio" 
                      value="manual" 
                      checked={integrationMode === 'manual'}
                      onChange={(e) => {
                        setIntegrationMode(e.target.value);
                        setSelectedRecommendation(null);
                      }}
                    />
                    <div className="mode-option-content">
                      <span>✋ Manual Assignment</span>
                      <small>Manually choose house, shift, and work days</small>
                    </div>
                  </label>
                </div>
              </div>

              {/* Automatic Recommendations */}
              {integrationMode === 'auto' && systemRecommendations.length > 0 && (
                <div className="recommendations">
                  <h4>System Recommendations: (Select one to proceed)</h4>
                  {systemRecommendations.map((rec, index) => (
                    <div 
                      key={index} 
                      className={`recommendation-item ${selectedRecommendation === rec ? 'selected' : ''}`}
                      onClick={() => setSelectedRecommendation(rec)}
                      style={{ cursor: 'pointer', border: selectedRecommendation === rec ? '2px solid #007bff' : '1px solid #ddd' }}
                    >
                      <div className="rec-header">
                        <span className="rec-rank">
                          {selectedRecommendation === rec ? '✓ Selected' : `Option #${index + 1}`}
                        </span>
                        <span className="rec-coverage" title={`This assignment would cover ${rec.weakSlotsCovered} understaffed days out of ${rec.totalWeakSlots} total coverage gaps in the system`}>
                          Covers {rec.weakSlotsCovered} of {rec.totalWeakSlots} understaffed days
                        </span>
                      </div>
                      <div className="rec-details">
                        <strong style={{ fontSize: '16px', color: '#007bff' }}>{rec.houseName}</strong>
                        <span style={{ marginLeft: '8px', color: '#666' }}>• {rec.shift} Shift</span>
                        <div className="rec-explanation" style={{ 
                          marginTop: '12px', 
                          whiteSpace: 'pre-line',
                          lineHeight: '1.6',
                          fontSize: '13px'
                        }}>
                          {rec.explanation}
                        </div>
                      </div>
                    </div>
                  ))}
                  {!selectedRecommendation && (
                    <div className="selection-reminder">
                      <small style={{ color: '#dc3545', fontStyle: 'italic' }}>
                        Please click on one of the recommendations above to select it.
                      </small>
                    </div>
                  )}
                </div>
              )}

              {/* Manual Assignment */}
              {integrationMode === 'manual' && (
                <div className="manual-assignment">
                  <h4>Manual Assignment:</h4>
                  
                  <div className="assignment-fields">
                    <div className="field-group">
                      <label>House:</label>
                      <select 
                        value={manualAssignment.house} 
                        onChange={(e) => setManualAssignment(prev => ({...prev, house: e.target.value}))}
                      >
                        <option value="">Select House...</option>
                        {houses.map(house => (
                          <option key={house.house_id} value={house.house_id}>
                            {house.house_name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="field-group">
                      <label>Shift:</label>
                      <select 
                        value={manualAssignment.shift} 
                        onChange={(e) => setManualAssignment(prev => ({...prev, shift: e.target.value}))}
                      >
                        <option value="">Select Shift...</option>
                        {shiftDefs.map(shift => (
                          <option key={shift.key} value={shift.key}>
                            {shift.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="field-group">
                      <label>Work Days (Select specific days - 1 to 7 days):</label>
                      <div className="days-checkboxes">
                        {daysOfWeek.map(day => (
                          <label key={day} className="day-checkbox">
                            <input 
                              type="checkbox"
                              checked={manualAssignment.workDays.includes(day)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setManualAssignment(prev => ({
                                    ...prev, 
                                    workDays: [...prev.workDays, day]
                                  }));
                                } else {
                                  setManualAssignment(prev => ({
                                    ...prev,
                                    workDays: prev.workDays.filter(d => d !== day)
                                  }));
                                }
                              }}
                            />
                            {day.slice(0, 3)}
                          </label>
                        ))}
                      </div>
                      <small>Selected: {manualAssignment.workDays.length} day(s)</small>
                      {manualAssignment.workDays.length > 0 && (
                        <small style={{ color: '#28a745', display: 'block', marginTop: '4px', fontWeight: 'bold' }}>
                          ✓ Selected days: {manualAssignment.workDays.join(', ')}
                        </small>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        
        <div className="modal-footer">
          <button 
            className="execute-integration-btn" 
            onClick={onExecute}
            disabled={isIntegrating || !selectedNewCaregiver || 
              (integrationMode === 'auto' && !selectedRecommendation) ||
              (integrationMode === 'manual' && (!manualAssignment.house || !manualAssignment.shift || manualAssignment.workDays.length === 0))}
          >
            {isIntegrating ? 'Integrating...' : 'Integrate Caregiver'}
          </button>
          <button className="cancel-integration-btn" onClick={onCancel} disabled={isIntegrating}>
            Cancel
          </button>
        </div>
      </div>
    </div>
    
    {/* Loading Modal */}
    {isIntegrating && (
      <div className="popup-overlay" style={{ zIndex: 10000 }}>
        <div className="popup-card">
          <div className="loading-spinner"></div>
          <p>Integrating caregiver... Please wait</p>
          <small style={{ color: '#666', marginTop: '10px' }}>This may take a few moments</small>
        </div>
      </div>
    )}
    </>
  );
}
