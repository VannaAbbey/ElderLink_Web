/**
 * Incident Reports Export Service
 * Handles exporting incident reports to PDF format with summary view
 */

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// Explicitly attach autoTable to jsPDF prototype
if (jsPDF && jsPDF.API && !jsPDF.API.autoTable) {
  jsPDF.API.autoTable = autoTable;
}

/**
 * Export incident reports to PDF document
 * Creates a comprehensive report with all incident details
 * @param {Object} exportData - Contains incidents, filters, etc.
 * @returns {Promise<void>}
 */
export const exportIncidentReportsToPDF = async (exportData) => {
  try {
    const {
      incidents,
      showAllIncidents,
      selectedDate,
      formatDate,
      formatTime,
      formatDateTime
    } = exportData;

    console.log('📄 Starting Incident Reports PDF export...');

    if (!incidents || incidents.length === 0) {
      throw new Error('No incident reports to export.');
    }

    // Create new PDF document
    const doc = new jsPDF('l', 'mm', 'a4'); // landscape, millimeters, A4 size
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    
    // Define colors
    const primaryColor = [30, 58, 95]; // #1e3a5f
    const secondaryColor = [44, 95, 141]; // #2c5f8d
    const lightGray = [240, 240, 240];
    const darkGray = [100, 100, 100];
    const incidentColor = [232, 241, 248]; // #e8f1f8

    // ========== HEADER ==========
    doc.setFillColor(...primaryColor);
    doc.rect(0, 0, pageWidth, 40, 'F');
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.setFont('helvetica', 'bold');
    doc.text('INCIDENT REPORTS', pageWidth / 2, 18, { align: 'center' });
    
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text('ElderLink Care Management System', pageWidth / 2, 30, { align: 'center' });

    // ========== FILTER INFO ==========
    let filterText = 'All Incident Reports';
    if (!showAllIncidents && selectedDate) {
      const dateObj = new Date(selectedDate);
      filterText = `Incidents for ${dateObj.toLocaleDateString('en-US', { 
        weekday: 'long',
        month: 'long', 
        day: 'numeric', 
        year: 'numeric' 
      })}`;
    }

    doc.setFillColor(...lightGray);
    doc.roundedRect(15, 50, pageWidth - 30, 20, 3, 3, 'F');
    
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('Report Period:', 20, 58);
    doc.setFont('helvetica', 'normal');
    doc.text(filterText, 60, 58);
    
    doc.setFont('helvetica', 'bold');
    doc.text('Total Incidents:', 20, 65);
    doc.setFont('helvetica', 'normal');
    doc.text(`${incidents.length}`, 60, 65);
    
    doc.setFont('helvetica', 'bold');
    doc.text('Generated:', pageWidth / 2 + 10, 58);
    doc.setFont('helvetica', 'normal');
    doc.text(new Date().toLocaleDateString('en-US'), pageWidth / 2 + 40, 58);

    let yPos = 80;

    // ========== INCIDENTS TABLE ==========
    doc.setFillColor(...primaryColor);
    doc.roundedRect(15, yPos, pageWidth - 30, 8, 2, 2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('DETAILED INCIDENT REPORTS', 20, yPos + 6);

    yPos += 12;

    // Prepare table data
    const tableData = incidents.map(incident => {
      const dateTimeStr = formatDateTime(incident.incident_date_time);
      const incidentType = incident.incident_type || 'N/A';
      const elderlyName = incident.elderlyName || 'Unknown';
      const house = incident.house_id || 'N/A';
      const caregiver = incident.caregiverName || 'Unknown';
      const nurses = incident.nurseNames && incident.nurseNames.length > 0 
        ? incident.nurseNames.join(', ') 
        : 'None notified';
      
      let additionalInfo = incident.additional_info || 'No additional details';
      if (additionalInfo.length > 100) {
        additionalInfo = additionalInfo.substring(0, 97) + '...';
      }

      return [
        dateTimeStr,
        incidentType,
        elderlyName,
        house,
        caregiver,
        nurses,
        additionalInfo
      ];
    });

    // Add table
    autoTable(doc, {
      startY: yPos,
      head: [['Date & Time', 'Type', 'Elderly', 'House', 'Reported By', 'Nurses Notified', 'Details']],
      body: tableData,
      theme: 'grid',
      headStyles: {
        fillColor: primaryColor,
        textColor: 255,
        fontSize: 8,
        fontStyle: 'bold',
        halign: 'left'
      },
      bodyStyles: {
        fontSize: 7,
        textColor: 0
      },
      columnStyles: {
        0: { cellWidth: 35 },  // Date & Time
        1: { cellWidth: 25 },  // Type
        2: { cellWidth: 30 },  // Elderly
        3: { cellWidth: 18, halign: 'center' },  // House
        4: { cellWidth: 30 },  // Reported By
        5: { cellWidth: 35 },  // Nurses
        6: { cellWidth: 'auto' }  // Details
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

    // ========== SUMMARY STATISTICS (if multiple pages, add on last page) ==========
    // Count incident types
    const incidentTypes = {};
    incidents.forEach(incident => {
      const type = incident.incident_type || 'Unknown';
      incidentTypes[type] = (incidentTypes[type] || 0) + 1;
    });

    // Add new page for summary if needed
    if (incidents.length > 15) {
      doc.addPage();
      yPos = 20;
      
      doc.setFillColor(...primaryColor);
      doc.roundedRect(15, yPos, pageWidth - 30, 8, 2, 2, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('INCIDENT TYPES SUMMARY', 20, yPos + 6);
      
      yPos += 15;
      
      // Create summary table
      const summaryData = Object.entries(incidentTypes).map(([type, count]) => [
        type,
        count,
        `${((count / incidents.length) * 100).toFixed(1)}%`
      ]);
      
      autoTable(doc, {
        startY: yPos,
        head: [['Incident Type', 'Count', 'Percentage']],
        body: summaryData,
        theme: 'striped',
        headStyles: {
          fillColor: primaryColor,
          textColor: 255,
          fontSize: 10,
          fontStyle: 'bold'
        },
        bodyStyles: {
          fontSize: 9,
          textColor: 0
        },
        columnStyles: {
          0: { cellWidth: 'auto' },
          1: { cellWidth: 40, halign: 'center' },
          2: { cellWidth: 40, halign: 'center' }
        },
        margin: { left: 15, right: 15 }
      });
    }

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
      doc.text('ElderLink Care Management System - Incident Reports', 15, pageHeight - 6);
      doc.text(`Generated: ${new Date().toLocaleString('en-US')}`, pageWidth - 15, pageHeight - 6, { align: 'right' });
    }
    
    // ========== SAVE THE PDF ==========
    const dateStr = showAllIncidents 
      ? 'All_Incidents' 
      : selectedDate 
        ? new Date(selectedDate).toLocaleDateString('en-US').replace(/\//g, '-')
        : 'Incidents';
    const fileName = `Incident_Reports_${dateStr}.pdf`;
    doc.save(fileName);
    
    console.log(`✅ PDF exported successfully: ${fileName}`);
    
  } catch (error) {
    console.error('❌ Error exporting PDF:', error);
    throw error;
  }
};
