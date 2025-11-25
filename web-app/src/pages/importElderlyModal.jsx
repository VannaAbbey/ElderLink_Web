// src/pages/importElderlyModal.jsx
import React, { useState } from 'react';
import '../css/elderlyManagement.css';
import { 
  parseCSV, 
  parseExcel, 
  importElderlyToFirestore,
  downloadCSVTemplate 
} from '../services/elderlyImportService';

export default function ImportElderlyModal({ isOpen, onClose, onImportComplete }) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [totalRecords, setTotalRecords] = useState(0);
  const [importResults, setImportResults] = useState(null);

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      const fileExtension = file.name.split('.').pop().toLowerCase();
      if (!['csv', 'xlsx', 'xls'].includes(fileExtension)) {
        alert('Please select a CSV or Excel file');
        return;
      }
      setSelectedFile(file);
      setImportResults(null);
    }
  };

  const handleImport = async () => {
    if (!selectedFile) {
      alert('Please select a file first');
      return;
    }

    setIsImporting(true);
    setProgress(0);
    setImportResults(null);

    try {
      let elderlyData = [];
      const fileExtension = selectedFile.name.split('.').pop().toLowerCase();

      if (fileExtension === 'csv') {
        const text = await selectedFile.text();
        elderlyData = parseCSV(text);
      } else {
        elderlyData = await parseExcel(selectedFile);
      }

      setTotalRecords(elderlyData.length);

      const results = await importElderlyToFirestore(
        elderlyData,
        (current, total) => {
          setProgress(Math.round((current / total) * 100));
        }
      );

      setImportResults(results);
      
      if (results.success > 0) {
        setTimeout(() => {
          onImportComplete(results);
        }, 2000);
      }
    } catch (error) {
      console.error('Import error:', error);
      alert(`Import failed: ${error.message}`);
    } finally {
      setIsImporting(false);
    }
  };

  const handleClose = () => {
    if (!isImporting) {
      setSelectedFile(null);
      setProgress(0);
      setImportResults(null);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="overlay">
      <div className="overlay-content import-modal-content">
        <span 
          className="overlay-close" 
          onClick={handleClose}
          style={{ cursor: isImporting ? 'not-allowed' : 'pointer' }}
        >
          ✖
        </span>
        
        <h2 className="overlay-header">📥 Import Elderly Data</h2>

        <div className="import-instructions">
          <h3>Instructions:</h3>
          <ol>
            <li>Download the CSV template using the button below</li>
            <li>Fill in the elderly information following the template format</li>
            <li>Upload the completed CSV or Excel file</li>
            <li>Click "Import" to add the data to the database</li>
          </ol>
          
          <button 
            className="download-template-btn"
            onClick={downloadCSVTemplate}
            disabled={isImporting}
          >
            📄 Download CSV Template
          </button>
        </div>

        <div className="file-upload-section">
          <label className="file-input-label">
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={handleFileSelect}
              disabled={isImporting}
            />
            <span className="file-input-button">
              {selectedFile ? '✅ Change File' : '📁 Select File'}
            </span>
          </label>
          
          {selectedFile && (
            <div className="selected-file-info">
              <strong>Selected:</strong> {selectedFile.name}
            </div>
          )}
        </div>

        {isImporting && (
          <div className="import-progress">
            <div className="progress-bar-container">
              <div 
                className="progress-bar-fill" 
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="progress-text">
              Importing... {progress}% ({Math.round((progress / 100) * totalRecords)} / {totalRecords})
            </p>
          </div>
        )}

        {importResults && (
          <div className="import-results">
            <h3>Import Results:</h3>
            <div className="results-summary">
              <div className="result-item success">
                ✅ Successfully imported: <strong>{importResults.success}</strong>
              </div>
              <div className="result-item failed">
                ❌ Failed: <strong>{importResults.failed}</strong>
              </div>
            </div>

            {importResults.errors.length > 0 && (
              <div className="error-details">
                <h4>Errors:</h4>
                <div className="error-list">
                  {importResults.errors.slice(0, 5).map((error, index) => (
                    <div key={index} className="error-item">
                      <strong>Row {error.row} ({error.name}):</strong>
                      <ul>
                        {error.errors.map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                  {importResults.errors.length > 5 && (
                    <p className="more-errors">
                      ... and {importResults.errors.length - 5} more errors
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="overlay-buttons">
          <button 
            className="save-btn" 
            onClick={handleImport}
            disabled={!selectedFile || isImporting}
          >
            {isImporting ? 'Importing...' : '📥 Import'}
          </button>
          <button 
            className="cancel-btn" 
            onClick={handleClose}
            disabled={isImporting}
          >
            {importResults ? 'Close' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}
