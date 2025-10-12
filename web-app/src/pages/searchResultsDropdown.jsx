export default function SearchResultsDropdown({ 
  isOpen, 
  searchQuery, 
  searchResults, 
  onNavigate 
}) {
  if (!isOpen) return null;

  return (
    <div className="search-results-dropdown">
      {searchResults.length === 0 ? (
        <div className="no-results">
          No caregivers found matching "{searchQuery}"
        </div>
      ) : (
        <>
          <div className="search-results-header">
            Found {searchResults.length} caregiver{searchResults.length !== 1 ? 's' : ''}
          </div>
          {searchResults.map((result, index) => (
            <div key={index} className="search-result-item">
              <div className="search-result-header">
                <span className="caregiver-name">
                  {result.caregiver.user_fname} {result.caregiver.user_lname}
                </span>
                <span className="search-result-badges">
                  {result.absenceDetails.isAbsent && (
                    <span className={`absence-badge ${result.absenceDetails.type === 'on_leave' ? 'on-leave' : 'absent'}`}>
                      {result.absenceDetails.type === 'on_leave' ? '🏖️ On Leave' : '❌ Absent'}
                    </span>
                  )}
                  {result.isEmergency && (
                    <span className="emergency-badge">🚨 Emergency</span>
                  )}
                </span>
              </div>
              <div className="search-result-details">
                <div className="assignment-info">
                  <strong>Assignment:</strong> {result.houseName} - {result.assignment.shift} Shift
                </div>
                <div className="work-days">
                  <strong>Work Days:</strong> {result.assignment.days_assigned?.join(', ') || 'Not assigned'}
                </div>
                <div className="elderly-count">
                  <strong>Elderly Assigned:</strong> {result.assignedElderly.length} elder{result.assignedElderly.length !== 1 ? 's' : ''}
                </div>
                {result.assignedElderly.length > 0 && (
                  <div className="elderly-names">
                    {result.assignedElderly.slice(0, 3).map(elder => 
                      `${elder.elderly_fname} ${elder.elderly_lname}`
                    ).join(', ')}
                    {result.assignedElderly.length > 3 && ` +${result.assignedElderly.length - 3} more`}
                  </div>
                )}
              </div>
              <button 
                onClick={() => onNavigate(result.assignment.house_id, result.assignment.shift)}
                className="navigate-btn"
              >
                View in Schedule →
              </button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
