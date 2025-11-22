/**
 * Shift Logs Export Service
 * Handles exporting shift logs to PDF format with summary view
 */

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// Explicitly attach autoTable to jsPDF prototype
if (jsPDF && jsPDF.API && !jsPDF.API.autoTable) {
  jsPDF.API.autoTable = autoTable;
}

/**
 * Export shift logs summary to PDF document
 * Creates a compact summary view instead of full log cards
 * @param {Object} exportData - Contains logs, date, filters, etc.
 * @returns {Promise<void>}
 */
export const exportShiftLogsSummaryToPDF = async (exportData) => {
  try {
    const {
      logs,
      date,
      shift,
      logType,
      shifts,
      logTypes
    } = exportData;

    console.log('📄 Starting Shift Logs PDF export...');

    if (!logs || logs.length === 0) {
      throw new Error('No logs to export. Please select a date with activity.');
    }

    // Create new PDF document
    const doc = new jsPDF('l', 'mm', 'a4'); // landscape, millimeters, A4 size
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    
    // Define colors
    const primaryColor = [0, 123, 255]; // #007bff
    const taskColor = [40, 167, 69]; // #28a745
    const incidentColor = [255, 193, 7]; // #ffc107
    const emergencyColor = [220, 53, 69]; // #dc3545
    const lightGray = [240, 240, 240];
    const darkGray = [100, 100, 100];

    // ========== HEADER ==========
    doc.setFillColor(...primaryColor);
    doc.rect(0, 0, pageWidth, 40, 'F');
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.setFont('helvetica', 'bold');
    doc.text('SHIFT LOGS SUMMARY REPORT', pageWidth / 2, 18, { align: 'center' });
    
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text('ElderLink Care Management System', pageWidth / 2, 30, { align: 'center' });

    // ========== DATE AND FILTER INFO ==========
    const dateStr = date.toLocaleDateString('en-US', { 
      weekday: 'long',
      month: 'long', 
      day: 'numeric', 
      year: 'numeric' 
    });

    const shiftName = shifts.find(s => s.key === shift)?.name || 'All Shifts';
    const logTypeName = logTypes.find(lt => lt.key === logType)?.name || 'All Activities';

    doc.setFillColor(...lightGray);
    doc.roundedRect(15, 50, pageWidth - 30, 25, 3, 3, 'F');
    
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('Date:', 20, 60);
    doc.setFont('helvetica', 'normal');
    doc.text(dateStr, 40, 60);
    
    doc.setFont('helvetica', 'bold');
    doc.text('Shift:', 20, 68);
    doc.setFont('helvetica', 'normal');
    doc.text(shiftName, 40, 68);
    
    doc.setFont('helvetica', 'bold');
    doc.text('Activity Type:', pageWidth / 2 + 10, 60);
    doc.setFont('helvetica', 'normal');
    doc.text(logTypeName, pageWidth / 2 + 45, 60);
    
    doc.setFont('helvetica', 'bold');
    doc.text('Total Logs:', pageWidth / 2 + 10, 68);
    doc.setFont('helvetica', 'normal');
    doc.text(`${logs.length}`, pageWidth / 2 + 45, 68);

    // ========== STATISTICS SUMMARY ==========
    const taskCount = logs.filter(l => l.log_type === 'task').length;
    const incidentCount = logs.filter(l => l.log_type === 'incident_report').length;
    const emergencyCount = logs.filter(l => l.log_type === 'emergency_alert').length;

    let yPos = 85;
    
    doc.setFillColor(...primaryColor);
    doc.roundedRect(15, yPos, pageWidth - 30, 8, 2, 2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('ACTIVITY SUMMARY', 20, yPos + 6);
    
    yPos += 15;
    
    // Stats boxes
    const boxWidth = (pageWidth - 50) / 3;
    
    // Tasks box
    doc.setFillColor(40, 167, 69, 30); // Light green
    doc.roundedRect(15, yPos, boxWidth, 20, 2, 2, 'F');
    doc.setTextColor(...taskColor);
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text(`${taskCount}`, 15 + boxWidth / 2, yPos + 10, { align: 'center' });
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text('Tasks Completed', 15 + boxWidth / 2, yPos + 16, { align: 'center' });
    
    // Incidents box
    doc.setFillColor(255, 193, 7, 30); // Light yellow
    doc.roundedRect(20 + boxWidth, yPos, boxWidth, 20, 2, 2, 'F');
    doc.setTextColor(...incidentColor);
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text(`${incidentCount}`, 20 + boxWidth + boxWidth / 2, yPos + 10, { align: 'center' });
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text('Incident Reports', 20 + boxWidth + boxWidth / 2, yPos + 16, { align: 'center' });
    
    // Emergencies box
    doc.setFillColor(220, 53, 69, 30); // Light red
    doc.roundedRect(25 + boxWidth * 2, yPos, boxWidth, 20, 2, 2, 'F');
    doc.setTextColor(...emergencyColor);
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text(`${emergencyCount}`, 25 + boxWidth * 2 + boxWidth / 2, yPos + 10, { align: 'center' });
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text('Emergency Alerts', 25 + boxWidth * 2 + boxWidth / 2, yPos + 16, { align: 'center' });

    yPos += 30;

    // ========== DETAILED LOGS TABLE ==========
    doc.setFillColor(...primaryColor);
    doc.roundedRect(15, yPos, pageWidth - 30, 8, 2, 2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('DETAILED ACTIVITY LOG', 20, yPos + 6);

    yPos += 12;

    // Helper function to format timestamp
    const formatTime = (timestamp) => {
      if (!timestamp) return 'N/A';
      const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      return date.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: true 
      });
    };

    // Prepare table data
    const tableData = logs.map(log => {
      const time = formatTime(log.logged_at);
      const type = log.log_type === 'task' ? 'Task' : 
                   log.log_type === 'incident_report' ? 'Incident' : 
                   'Emergency';
      const caregiver = log.caregiver_fname || 'Unknown';
      const elderly = log.elderly_fname || 'N/A';
      
      let description = '';
      if (log.log_type === 'task') {
        description = log.task_description || 'Task completed';
      } else if (log.log_type === 'incident_report') {
        description = `${log.incident_type || 'Incident'}${log.additional_info ? ': ' + log.additional_info : ''}`;
      } else if (log.log_type === 'emergency_alert') {
        description = `${log.emergency_type || 'Emergency'}${log.additional_info ? ': ' + log.additional_info : ''}`;
      }
      
      // Truncate description if too long
      if (description.length > 80) {
        description = description.substring(0, 77) + '...';
      }

      return [
        time,
        type,
        caregiver,
        elderly,
        description
      ];
    });

    // Add table
    autoTable(doc, {
      startY: yPos,
      head: [['Time', 'Type', 'Caregiver', 'Elderly', 'Description']],
      body: tableData,
      theme: 'grid',
      headStyles: {
        fillColor: primaryColor,
        textColor: 255,
        fontSize: 9,
        fontStyle: 'bold',
        halign: 'left'
      },
      bodyStyles: {
        fontSize: 8,
        textColor: 0
      },
      columnStyles: {
        0: { cellWidth: 25, halign: 'center' },  // Time
        1: { cellWidth: 25, halign: 'center' },  // Type
        2: { cellWidth: 35 },  // Caregiver
        3: { cellWidth: 35 },  // Elderly
        4: { cellWidth: 'auto' }  // Description
      },
      margin: { left: 15, right: 15 },
      alternateRowStyles: {
        fillColor: [245, 245, 245]
      },
      didDrawPage: function(data) {
        // Add page number on each page
        const pageCount = doc.internal.getNumberOfPages();
        const currentPage = doc.internal.getCurrentPageInfo().pageNumber;
        
        doc.setFontSize(8);
        doc.setTextColor(...darkGray);
        doc.text(`Page ${currentPage} of ${pageCount}`, pageWidth - 15, pageHeight - 8, { align: 'right' });
      }
    });

    // ========== FOOTER ON ALL PAGES ==========
    const totalPages = doc.internal.getNumberOfPages();
    
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      
      // Add footer line
      doc.setDrawColor(...lightGray);
      doc.setLineWidth(0.5);
      doc.line(10, pageHeight - 12, pageWidth - 10, pageHeight - 12);
      
      // Add footer text
      doc.setFontSize(8);
      doc.setTextColor(...darkGray);
      doc.setFont('helvetica', 'normal');
      doc.text('ElderLink Care Management System - Shift Logs Report', 15, pageHeight - 6);
      doc.text(`Generated: ${new Date().toLocaleString('en-US')}`, pageWidth - 15, pageHeight - 6, { align: 'right' });
    }
    
    // ========== SAVE THE PDF ==========
    const fileName = `Shift_Logs_${dateStr.replace(/\s/g, '_').replace(/,/g, '')}.pdf`;
    doc.save(fileName);
    
    console.log(`✅ PDF exported successfully: ${fileName}`);
    
  } catch (error) {
    console.error('❌ Error exporting PDF:', error);
    throw error;
  }
};
