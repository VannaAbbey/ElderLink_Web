// src/pages/scheduleCustomizationModal.jsx
import React, { useState, useEffect } from 'react';
import '../css/scheduleCustomization.css';

export default function ScheduleCustomizationModal({ 
  isOpen, 
  onClose, 
  onGenerate, 
  houses, 
  caregivers,
  onDurationChange
}) {
  const [housePriorities, setHousePriorities] = useState({});
  const [shiftPreferences, setShiftPreferences] = useState({});
  const [exactCounts, setExactCounts] = useState({}); // Exact caregiver counts per house
  const [exactShiftCounts, setExactShiftCounts] = useState({}); // Exact shift counts per house
  const [useExactCounts, setUseExactCounts] = useState(false); // Toggle between priority/exact mode
  const [workPattern, setWorkPattern] = useState({ workDays: 5, restDays: 2 }); // Work/rest day pattern
  const [distribution, setDistribution] = useState(null);
  const [duration, setDuration] = useState(6); // Duration in months
  const [customDuration, setCustomDuration] = useState(""); // Custom duration input
  
  const totalCaregivers = caregivers?.length || 0;

  const shiftDefs = [
    { name: "1st Shift (6:00 AM - 2:00 PM)", key: "1st" },
    { name: "2nd Shift (2:00 PM - 10:00 PM)", key: "2nd" },
    { name: "3rd Shift (10:00 PM - 6:00 AM)", key: "3rd" },
  ];

  useEffect(() => {
    if (isOpen && houses.length > 0) {
      // Initialize default priorities (normal for all)
      const defaultPriorities = {};
      const defaultShifts = {};
      const defaultExactCounts = {};
      
      houses.forEach(house => {
        defaultPriorities[house.house_id] = 'normal';
        defaultShifts[house.house_id] = {
          '1st': 'normal',
          '2nd': 'normal',
          '3rd': 'normal'
        };
        defaultExactCounts[house.house_id] = 0; // Will be calculated on preview
      });
      
      const defaultExactShifts = {};
      houses.forEach(house => {
        defaultExactShifts[house.house_id] = {
          '1st': 0,
          '2nd': 0,
          '3rd': 0
        };
      });
      
      setHousePriorities(defaultPriorities);
      setShiftPreferences(defaultShifts);
      setExactCounts(defaultExactCounts);
      setExactShiftCounts(defaultExactShifts);
      setUseExactCounts(false); // Default to priority mode
      setWorkPattern({ workDays: 5, restDays: 2 }); // Default work pattern
    }
  }, [isOpen, houses]);

  const handleHousePriorityChange = (houseId, priority) => {
    setHousePriorities(prev => ({
      ...prev,
      [houseId]: priority
    }));
  };

  const handleShiftPreferenceChange = (houseId, shift, preference) => {
    setShiftPreferences(prev => ({
      ...prev,
      [houseId]: {
        ...prev[houseId],
        [shift]: preference
      }
    }));
  };

  const handleExactCountChange = (houseId, count) => {
    const numCount = parseInt(count) || 0;
    setExactCounts(prev => ({
      ...prev,
      [houseId]: Math.min(Math.max(0, numCount), totalCaregivers)
    }));
  };

  const handleModeToggle = (mode) => {
    setUseExactCounts(mode === 'exact');
  };

  const handleExactShiftCountChange = (houseId, shift, count) => {
    const numCount = parseInt(count) || 0;
    setExactShiftCounts(prev => ({
      ...prev,
      [houseId]: {
        ...prev[houseId],
        [shift]: Math.max(0, numCount)
      }
    }));
  };

  // Auto-calculate distribution whenever settings change
  useEffect(() => {
    const calculateDistribution = () => {
      const dist = {};

      if (useExactCounts) {
      // Use exact counts mode - check if using manual shift counts
      const usingExactShifts = Object.values(exactShiftCounts).some(shifts => 
        shifts['1st'] > 0 || shifts['2nd'] > 0 || shifts['3rd'] > 0
      );

      if (usingExactShifts) {
        // Only validate if user has specified both total count AND shift allocations
        houses.forEach(house => {
          const shifts = exactShiftCounts[house.house_id] || { '1st': 0, '2nd': 0, '3rd': 0 };
          const totalShifts = shifts['1st'] + shifts['2nd'] + shifts['3rd'];
          const totalForHouse = exactCounts[house.house_id] || 0;

          // Only show warning if BOTH total count AND shift allocations are filled (not zero)
          const hasShiftAllocations = totalShifts > 0;
          const hasTotalCount = totalForHouse > 0;
          
          dist[house.house_id] = {
            total: totalShifts > 0 ? totalShifts : totalForHouse,
            shifts: {
              '1st': shifts['1st'],
              '2nd': shifts['2nd'],
              '3rd': shifts['3rd']
            },
            priority: 'exact',
            mode: 'exact-shift',
            validationWarning: (hasShiftAllocations && hasTotalCount && totalShifts !== totalForHouse) 
              ? `⚠️ Shift sum (${totalShifts}) ≠ Total (${totalForHouse})` 
              : null
          };
        });
      } else {
        // Use total counts with shift preference weights
        const totalRequested = Object.values(exactCounts).reduce((sum, count) => sum + count, 0);
        
        if (totalRequested > totalCaregivers) {
          alert(`Total requested caregivers (${totalRequested}) exceeds available caregivers (${totalCaregivers}). Please adjust.`);
          return;
        }

        houses.forEach(house => {
          const houseCaregivers = exactCounts[house.house_id] || 0;
          
          // Calculate shift distribution for this house
          const shiftPrefs = shiftPreferences[house.house_id] || {};
          const shiftWeights = {
            '1st': shiftPrefs['1st'] === 'more' ? 1.2 : shiftPrefs['1st'] === 'less' ? 0.8 : 1,
            '2nd': shiftPrefs['2nd'] === 'more' ? 1.2 : shiftPrefs['2nd'] === 'less' ? 0.8 : 1,
            '3rd': shiftPrefs['3rd'] === 'more' ? 1.2 : shiftPrefs['3rd'] === 'less' ? 0.8 : 1,
          };

          const totalShiftWeight = shiftWeights['1st'] + shiftWeights['2nd'] + shiftWeights['3rd'];
          
          dist[house.house_id] = {
            total: houseCaregivers,
            shifts: {
              '1st': Math.max(1, Math.floor(houseCaregivers * (shiftWeights['1st'] / totalShiftWeight))),
              '2nd': Math.max(1, Math.floor(houseCaregivers * (shiftWeights['2nd'] / totalShiftWeight))),
              '3rd': Math.max(1, Math.floor(houseCaregivers * (shiftWeights['3rd'] / totalShiftWeight)))
            },
            priority: 'exact',
            mode: 'exact'
          };
        });
      }
    } else {
      // Use priority-based mode (existing logic)
      // Step 1: Calculate house weights based on priority
      const weights = {};
      let totalWeight = 0;

      houses.forEach(house => {
        const priority = housePriorities[house.house_id] || 'normal';
        const weight = priority === 'high' ? 1 : priority === 'low' ? 0.8 : 1;
        weights[house.house_id] = weight;
        totalWeight += weight;
      });

      // Step 2: Distribute caregivers proportionally
      houses.forEach(house => {
        const proportion = weights[house.house_id] / totalWeight;
        const baseCaregivers = Math.floor(totalCaregivers * proportion);
        
        // Calculate shift distribution for this house
        const shiftPrefs = shiftPreferences[house.house_id] || {};
        const shiftWeights = {
          '1st': shiftPrefs['1st'] === 'more' ? 1.2 : shiftPrefs['1st'] === 'less' ? 0.8 : 1,
          '2nd': shiftPrefs['2nd'] === 'more' ? 1.2 : shiftPrefs['2nd'] === 'less' ? 0.8 : 1,
          '3rd': shiftPrefs['3rd'] === 'more' ? 1.2 : shiftPrefs['3rd'] === 'less' ? 0.8 : 1,
        };

        const totalShiftWeight = shiftWeights['1st'] + shiftWeights['2nd'] + shiftWeights['3rd'];
        
        dist[house.house_id] = {
          total: baseCaregivers,
          shifts: {
            '1st': Math.max(1, Math.floor(baseCaregivers * (shiftWeights['1st'] / totalShiftWeight))),
            '2nd': Math.max(1, Math.floor(baseCaregivers * (shiftWeights['2nd'] / totalShiftWeight))),
            '3rd': Math.max(1, Math.floor(baseCaregivers * (shiftWeights['3rd'] / totalShiftWeight)))
          },
          priority: housePriorities[house.house_id],
          mode: 'priority'
        };
      });
    }

      setDistribution(dist);
    };

    // Calculate on mount and whenever dependencies change
    calculateDistribution();
  }, [houses, useExactCounts, exactCounts, exactShiftCounts, housePriorities, shiftPreferences, totalCaregivers]);

  const handleConfirmGeneration = () => {
    const finalDuration = customDuration ? parseInt(customDuration) : duration;
    // Pass customization settings to parent
    onGenerate({
      housePriorities,
      shiftPreferences,
      distribution,
      useExactCounts,
      exactCounts,
      exactShiftCounts,
      workPattern,
      duration: finalDuration
    });
  };

  const resetToDefaults = () => {
    const defaultPriorities = {};
    const defaultShifts = {};
    const defaultExactCounts = {};
    const defaultExactShifts = {};
    
    houses.forEach(house => {
      defaultPriorities[house.house_id] = 'normal';
      defaultShifts[house.house_id] = {
        '1st': 'normal',
        '2nd': 'normal',
        '3rd': 'normal'
      };
      defaultExactCounts[house.house_id] = 0;
      defaultExactShifts[house.house_id] = {
        '1st': 0,
        '2nd': 0,
        '3rd': 0
      };
    });
    
    setHousePriorities(defaultPriorities);
    setShiftPreferences(defaultShifts);
    setExactCounts(defaultExactCounts);
    setExactShiftCounts(defaultExactShifts);
    setUseExactCounts(false);
    setWorkPattern({ workDays: 5, restDays: 2 });
  };

  if (!isOpen) return null;

  return (
    <div className="customization-overlay">
      <div className="customization-modal">
        <div className="customization-header">
          <h2>⚙️ Customize Schedule Generation</h2>
          <p className="customization-subtitle">
            Configure settings for your new schedule
          </p>
          <button 
            className="modal-close-btn" 
            onClick={onClose}
            title="Close customization modal"
          >
            ✖
          </button>
        </div>

        <div className="customization-body">
          {/* Duration Selection Section */}
          <div className="customization-section">
            <h3>📅 Schedule Duration</h3>
            <p className="section-description">
              Select how many months the schedule should cover
            </p>
            <div className="duration-selection-container">
              <div className="duration-presets">
                <button
                  className={`duration-btn ${!customDuration && duration === 3 ? 'active' : ''}`}
                  onClick={() => {
                    setDuration(3);
                    setCustomDuration('');
                  }}
                >
                  <span className="duration-value">3</span>
                  <span className="duration-label">Months</span>
                </button>
                <button
                  className={`duration-btn ${!customDuration && duration === 6 ? 'active' : ''}`}
                  onClick={() => {
                    setDuration(6);
                    setCustomDuration('');
                  }}
                >
                  <span className="duration-value">6</span>
                  <span className="duration-label">Months</span>
                </button>
                <button
                  className={`duration-btn ${!customDuration && duration === 12 ? 'active' : ''}`}
                  onClick={() => {
                    setDuration(12);
                    setCustomDuration('');
                  }}
                >
                  <span className="duration-value">12</span>
                  <span className="duration-label">Months</span>
                </button>
              </div>
              <div className="custom-duration-input-group">
                <label htmlFor="customMonths">Or enter custom duration:</label>
                <div className="custom-duration-wrapper">
                  <input
                    id="customMonths"
                    type="number"
                    min="1"
                    max="36"
                    value={customDuration}
                    onChange={(e) => setCustomDuration(e.target.value)}
                    onFocus={(e) => e.target.select()}
                    placeholder="Enter months (1-36)"
                    className="custom-duration-input"
                  />
                  <span className="duration-unit">months</span>
                </div>
              </div>
            </div>
          </div>

          {/* Work Pattern Section */}
          <div className="customization-section">
            <h3>📅 Work Pattern Configuration</h3>
            <p className="section-description">
              Configure how many consecutive days caregivers work and rest per week
            </p>
            <div className="work-pattern-container">
              <div className="work-pattern-inputs">
                <div className="work-pattern-input-group">
                  <label htmlFor="workDays">
                    Work Days <span className="required-asterisk">*</span>
                  </label>
                  <input
                    id="workDays"
                    type="number"
                    min="1"
                    max="7"
                    value={workPattern.workDays}
                    onChange={(e) => {
                      const work = parseInt(e.target.value) || 1;
                      const rest = 7 - work;
                      setWorkPattern({ workDays: work, restDays: rest });
                    }}
                    className="work-pattern-input"
                  />
                  <small>Consecutive work days</small>
                </div>
                <div className="work-pattern-separator">+</div>
                <div className="work-pattern-input-group">
                  <label htmlFor="restDays">
                    Rest Days <span className="required-asterisk">*</span>
                  </label>
                  <input
                    id="restDays"
                    type="number"
                    min="0"
                    max="6"
                    value={workPattern.restDays}
                    onChange={(e) => {
                      const rest = parseInt(e.target.value) || 0;
                      const work = 7 - rest;
                      setWorkPattern({ workDays: work, restDays: rest });
                    }}
                    className="work-pattern-input"
                  />
                  <small>Consecutive rest days</small>
                </div>
                <div className="work-pattern-separator">=</div>
                <div className="work-pattern-total">
                  <span className="total-label">Total</span>
                  <span className="total-value">7 days</span>
                </div>
              </div>
              <div className="work-pattern-note">
                ℹ️ Default pattern: <strong>5 work days + 2 rest days</strong>. Adjust to customize the weekly work schedule.
              </div>
            </div>
          </div>

          {/* Mode Selection */}
          <div className="mode-selection-section">
            <div className="mode-header">
              <h3>📊 Distribution Mode</h3>
              <div className="caregiver-count-badge" title="Total available caregivers in database">
                👥 {totalCaregivers} Caregivers Available
              </div>
            </div>
            <p className="section-description">Choose how to allocate caregivers to houses</p>
            <div className="mode-toggle">
              <button
                className={`mode-btn ${!useExactCounts ? 'active' : ''}`}
                onClick={() => handleModeToggle('priority')}
                title="Use priority levels (Low=70%, Normal=100%, High=150%) to automatically distribute caregivers proportionally"
              >
                <span className="mode-icon">⚖️</span>
                <span className="mode-label">Priority-Based</span>
                <span className="mode-desc">Automatic distribution by priority</span>
              </button>
              <button
                className={`mode-btn ${useExactCounts ? 'active' : ''}`}
                onClick={() => handleModeToggle('exact')}
                title="Manually specify the exact number of caregivers for each house"
              >
                <span className="mode-icon">🎯</span>
                <span className="mode-label">Exact Count</span>
                <span className="mode-desc">Manual caregiver allocation</span>
              </button>
            </div>
          </div>
          {/* House Priority Section */}
          <div className="customization-section">
            <h3 title="Configure how many caregivers each house should receive">
              🏠 House Allocation
            </h3>
            <p className="section-description">
              {useExactCounts 
                ? 'Specify the exact number of caregivers for each house and shift' 
                : 'Select which houses should receive more caregivers (Low=80%, Normal=100%, High=100%)'}
            </p>
            
            <div className="house-priority-grid">
              {houses.map(house => (
                <div key={house.house_id} className="house-priority-card">
                  <div className="house-priority-header">
                    <strong title={`Configure caregiver allocation for ${house.house_name}`}>
                      {house.house_name}
                    </strong>
                    <span className="house-id-badge" title="House identifier">
                      {house.house_id}
                    </span>
                  </div>
                  
                  {useExactCounts ? (
                    // Exact Count Mode
                    <>
                      <div className="exact-count-input-container">
                        <label 
                          htmlFor={`exact-${house.house_id}`}
                          title="Enter the exact number of caregivers to assign to this house (optional - leave 0 to use shift counts below)"
                        >
                          Total Caregivers (Optional):
                        </label>
                        <input
                          id={`exact-${house.house_id}`}
                          type="number"
                          min="0"
                          max={totalCaregivers}
                          value={exactCounts[house.house_id] || ''}
                          onChange={(e) => handleExactCountChange(house.house_id, e.target.value)}
                          onFocus={(e) => e.target.select()}
                          className="exact-count-input"
                          title={`Assign 0-${totalCaregivers} caregivers to ${house.house_name}`}
                          placeholder="0"
                        />
                        <span className="count-label">
                          out of {totalCaregivers} total
                        </span>
                      </div>

                      {/* Manual Shift Count Inputs */}
                      <div className="shift-preferences">
                        <h4 title="Specify exact number of caregivers per shift (overrides total count if set)">
                          Exact Shift Allocation
                        </h4>
                        {shiftDefs.map(shift => (
                          <div key={shift.key} className="exact-shift-row">
                            <label 
                              className="shift-label"
                              title={`${shift.name} - Enter exact caregiver count`}
                            >
                              {shift.name}
                            </label>
                            <input
                              type="number"
                              min="0"
                              max={totalCaregivers}
                              value={exactShiftCounts[house.house_id]?.[shift.key] || ''}
                              onChange={(e) => handleExactShiftCountChange(house.house_id, shift.key, e.target.value)}
                              onFocus={(e) => e.target.select()}
                              className="exact-shift-input"
                              title={`Specify 0-${totalCaregivers} caregivers for this shift`}
                              placeholder="0"
                            />
                            <span className="shift-count-label">caregivers</span>
                          </div>
                        ))}
                        <p className="shift-note">
                          💡 Tip: Set shift counts directly or use total count with percentages below
                        </p>
                      </div>
                    </>
                  ) : (
                    // Priority Mode
                    <div className="priority-selector">
                      <label 
                        className="priority-option"
                        title="Low Priority: 80% weight - Receives fewer caregivers proportionally"
                      >
                        <input
                          type="radio"
                          name={`priority-${house.house_id}`}
                          value="low"
                          checked={housePriorities[house.house_id] === 'low'}
                          onChange={(e) => handleHousePriorityChange(house.house_id, e.target.value)}
                        />
                        <span className="priority-label low">Low Priority</span>
                        <small>80% weight</small>
                      </label>
                      
                      <label 
                        className="priority-option"
                        title="Normal Priority: 100% weight - Receives standard caregiver allocation"
                      >
                        <input
                          type="radio"
                          name={`priority-${house.house_id}`}
                          value="normal"
                          checked={housePriorities[house.house_id] === 'normal'}
                          onChange={(e) => handleHousePriorityChange(house.house_id, e.target.value)}
                        />
                        <span className="priority-label normal">Normal</span>
                        <small>100% weight</small>
                      </label>
                      
                      <label 
                        className="priority-option"
                        title="High Priority: 100% weight - Same as normal (for flexibility)"
                      >
                        <input
                          type="radio"
                          name={`priority-${house.house_id}`}
                          value="high"
                          checked={housePriorities[house.house_id] === 'high'}
                          onChange={(e) => handleHousePriorityChange(house.house_id, e.target.value)}
                        />
                        <span className="priority-label high">High Priority</span>
                        <small>100% weight</small>
                      </label>
                    </div>
                  )}

                  {/* Shift Preferences for this house (only shown when not using exact shift counts) */}
                  {!useExactCounts && (
                    <div className="shift-preferences">
                      <h4 title="Configure how caregivers are distributed across the three daily shifts">
                        Shift Distribution
                      </h4>
                      {shiftDefs.map(shift => (
                        <div key={shift.key} className="shift-preference-row">
                          <label 
                            className="shift-label"
                            title={`${shift.name} - Configure staffing level for this shift`}
                          >
                            {shift.name}
                          </label>
                          <select
                            value={shiftPreferences[house.house_id]?.[shift.key] || 'normal'}
                            onChange={(e) => handleShiftPreferenceChange(house.house_id, shift.key, e.target.value)}
                            className="shift-select"
                            title="Less=80%, Normal=100%, More=120% of proportional allocation"
                          >
                            <option value="less">Less staff (80%)</option>
                            <option value="normal">Normal (100%)</option>
                            <option value="more">More staff (120%)</option>
                          </select>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Preview section - Always visible */}
          {distribution && (
            <div className="preview-section">
              <h3 title="Preview of how caregivers will be distributed based on your settings">
                📊 Distribution Preview
              </h3>
              <p className="preview-description">
                Estimated caregiver distribution based on your settings ({useExactCounts ? 'Exact Count Mode' : 'Priority-Based Mode'})
              </p>
              
              <div className="preview-grid">
                {houses.map(house => {
                  const houseData = distribution[house.house_id];
                  return (
                    <div key={house.house_id} className="preview-card">
                      <div className="preview-header">
                        <strong title={`Distribution for ${house.house_name}`}>
                          {house.house_name}
                        </strong>
                        {!useExactCounts && (
                          <span 
                            className={`priority-badge ${houseData?.priority}`}
                            title={`Priority level: ${houseData?.priority === 'high' ? '150% weight' : houseData?.priority === 'low' ? '70% weight' : '100% weight'}`}
                          >
                            {houseData?.priority || 'normal'}
                          </span>
                        )}
                      </div>
                      <div className="preview-total" title="Total caregivers assigned to this house">
                        Total: <strong>{houseData?.total || 0}</strong> caregivers
                      </div>
                      <div className="preview-shifts">
                        <div 
                          className="shift-count"
                          title="Caregivers working 1st shift (6:00 AM - 2:00 PM)"
                        >
                          1st: {houseData?.shifts['1st'] || 0}
                        </div>
                        <div 
                          className="shift-count"
                          title="Caregivers working 2nd shift (2:00 PM - 10:00 PM)"
                        >
                          2nd: {houseData?.shifts['2nd'] || 0}
                        </div>
                        <div 
                          className="shift-count"
                          title="Caregivers working 3rd shift (10:00 PM - 6:00 AM)"
                        >
                          3rd: {houseData?.shifts['3rd'] || 0}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              
              <div className="preview-note" title="Important information about the preview">
                <strong>Note:</strong> Actual distribution may vary slightly based on caregiver availability 
                and the need to maintain balanced coverage across all days and shifts.
              </div>
            </div>
          )}
        </div>

        <div className="customization-footer">
          <button 
            className="reset-btn" 
            onClick={resetToDefaults}
            title="Reset all settings to default values (Normal priority, Normal shift distribution)"
          >
            🔄 Reset to Defaults
          </button>
          <div className="footer-actions">
            <button 
              className="cancel-customization-btn" 
              onClick={onClose}
              title="Cancel and close without generating schedule"
            >
              Cancel
            </button>
            <button 
              className="confirm-generation-btn" 
              onClick={handleConfirmGeneration}
              title="Generate schedule with current settings"
            >
              ✅ Generate Schedule
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
