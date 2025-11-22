/**
 * Schedule Export Service
 * Handles exporting caregiver schedules to various formats (PDF, Excel, etc.)
 */

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// Explicitly attach autoTable to jsPDF prototype
if (jsPDF && jsPDF.API && !jsPDF.API.autoTable) {
  jsPDF.API.autoTable = autoTable;
}

/**
 * Export the current schedule to a PDF document
 * @param {Object} scheduleData - Complete schedule data including assignments, caregivers, elderly, etc.
 * @returns {Promise<void>}
 */
export const exportScheduleToPDF = async (scheduleData) => {
  try {
    const {
      scheduleInfo,
      assignments,
      elderlyAssigns,
      caregivers,
      houses,
      elderlyList,
      shiftDefs,
      daysOfWeek,
      currentVersion
    } = scheduleData;

    console.log('📄 Starting PDF export...');

    // Validate required data
    if (!scheduleInfo || !scheduleInfo.start || !scheduleInfo.end) {
      throw new Error('Schedule information is missing. Please generate a schedule first.');
    }

    if (!assignments || assignments.length === 0) {
      throw new Error('No assignments found. Please generate a schedule first.');
    }

    // Create new PDF document
    const doc = new jsPDF('l', 'mm', 'a4'); // landscape, millimeters, A4 size
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    
    // Define colors
    const primaryColor = [33, 99, 134]; // #216386
    const secondaryColor = [85, 162, 204]; // #55A2CC
    const lightGray = [240, 240, 240];
    const darkGray = [100, 100, 100];

    // ========== PAGE 1: TITLE PAGE ==========
    
    // Add header background
    doc.setFillColor(...primaryColor);
    doc.rect(0, 0, pageWidth, 50, 'F');
    
    // Add title
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(28);
    doc.setFont('helvetica', 'bold');
    doc.text('CAREGIVER SCHEDULE REPORT', pageWidth / 2, 25, { align: 'center' });
    
    // Add subtitle
    doc.setFontSize(14);
    doc.setFont('helvetica', 'normal');
    doc.text('ElderLink Care Management System', pageWidth / 2, 38, { align: 'center' });
    
    // Add schedule period box
    const startDate = scheduleInfo.start.toLocaleDateString('en-US', { 
      month: 'long', 
      day: 'numeric', 
      year: 'numeric' 
    });
    const endDate = scheduleInfo.end.toLocaleDateString('en-US', { 
      month: 'long', 
      day: 'numeric', 
      year: 'numeric' 
    });
    
    doc.setFillColor(...lightGray);
    doc.roundedRect(40, 60, pageWidth - 80, 40, 3, 3, 'F');
    
    doc.setTextColor(...primaryColor);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('Schedule Period', pageWidth / 2, 75, { align: 'center' });
    
    doc.setFontSize(18);
    doc.setTextColor(0, 0, 0);
    doc.text(`${startDate} --> ${endDate}`, pageWidth / 2, 90, { align: 'center' });
    
    // Add summary statistics
    const currentAssignments = assignments.filter(a => a.is_current);
    const uniqueCaregivers = new Set(currentAssignments.map(a => a.user_id)).size;
    const totalHouses = houses.length;
    
    doc.setFillColor(...secondaryColor);
    doc.roundedRect(40, 130, pageWidth - 80, 50, 3, 3, 'F');
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    
    const statY = 145;
    doc.text(`Total Caregivers: ${uniqueCaregivers}`, 60, statY);
    doc.text(`Total Houses: ${totalHouses}`, pageWidth / 2 - 20, statY);
    doc.text(`Total Elderly: ${elderlyList.length}`, pageWidth - 100, statY);
    
    doc.text(`Total Assignments: ${elderlyAssigns.length}`, 60, statY + 15);
    doc.text(`Schedule Version: ${currentVersion}`, pageWidth / 2 - 20, statY + 15);
    doc.text(`Shifts: 3 (1st, 2nd, 3rd)`, pageWidth - 100, statY + 15);

    // ========== SUBSEQUENT PAGES: DETAILED SCHEDULE BY HOUSE ==========
    
    // Sort houses by house_id (H001 to H005)
    const sortedHouses = [...houses].sort((a, b) => {
      const numA = parseInt(a.house_id.replace(/\D/g, ""), 10);
      const numB = parseInt(b.house_id.replace(/\D/g, ""), 10);
      return numA - numB;
    });

    // Helper function to get caregiver name
    const getCaregiverName = (userId) => {
      const caregiver = caregivers.find(cg => cg.id === userId);
      if (!caregiver) return 'Unknown';
      return `${caregiver.user_fname} ${caregiver.user_lname}`;
    };

    // Helper function to get elderly assigned to a caregiver for a specific day
    const getElderlyForCaregiverOnDay = (caregiverId, dayName) => {
      const elderlyIds = new Set();
      
      const assignment = elderlyAssigns.find(
        ea => ea.user_id === caregiverId && 
             ea.day?.toLowerCase() === dayName.toLowerCase() &&
             ea.assign_version === currentVersion
      );
      
      if (assignment && assignment.elderly_ids) {
        assignment.elderly_ids.forEach(id => elderlyIds.add(id));
      }
      
      return Array.from(elderlyIds).map(id => {
        const elderly = elderlyList.find(e => e.id === id);
        if (!elderly) return 'Unknown';
        return `${elderly.elderly_fname} ${elderly.elderly_lname}`;
      }).sort();
    };

    let pageCounter = 1; // Track actual page numbers (excluding blank pages)

    // Process each house
    for (let houseIndex = 0; houseIndex < sortedHouses.length; houseIndex++) {
      const house = sortedHouses[houseIndex];
      
      // Add new page for each house
      doc.addPage();
      pageCounter++;
      
      // Add house header
      doc.setFillColor(...primaryColor);
      doc.rect(0, 0, pageWidth, 30, 'F');
      
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(20);
      doc.setFont('helvetica', 'bold');
      doc.text(`${house.house_name}`, 15, 18);
      
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(`Page ${pageCounter}`, pageWidth - 15, 18, { align: 'right' });
      
      let yPosition = 40;
      
      // Process each day of the week for this house
      for (const dayName of daysOfWeek) {
        // Process each shift for this day
        for (const shift of shiftDefs) {
          // Get assignments for this house, day and shift
          const houseShiftAssignments = currentAssignments.filter(a => {
            const matchesHouse = a.house_id === house.house_id;
            const worksThisDay = a.days_assigned && a.days_assigned.includes(dayName);
            const matchesShift = a.shift === shift.key;
            return matchesHouse && worksThisDay && matchesShift;
          });
          
          if (houseShiftAssignments.length === 0) {
            continue; // Skip if no assignments for this combination
          }
          
          // Check if we need a new page before adding this section
          if (yPosition > pageHeight - 80) {
            doc.addPage();
            pageCounter++;
            
            // Re-add house header on new page
            doc.setFillColor(...primaryColor);
            doc.rect(0, 0, pageWidth, 30, 'F');
            doc.setTextColor(255, 255, 255);
            doc.setFontSize(20);
            doc.setFont('helvetica', 'bold');
            doc.text(`${house.house_name}`, 15, 18);
            doc.setFontSize(10);
            doc.setFont('helvetica', 'normal');
            doc.text(`Page ${pageCounter}`, pageWidth - 15, 18, { align: 'right' });
            
            yPosition = 40;
          }
          
          // Add section header (Day - Shift)
          doc.setFillColor(...lightGray);
          doc.rect(10, yPosition, pageWidth - 20, 12, 'F');
          
          doc.setTextColor(...primaryColor);
          doc.setFontSize(14);
          doc.setFont('helvetica', 'bold');
          doc.text(`${dayName} - ${shift.name}`, 15, yPosition + 8);
          
          yPosition += 18;
          
          // Prepare table data
          const tableData = [];
          
          houseShiftAssignments.forEach(assignment => {
            const caregiverName = getCaregiverName(assignment.user_id);
            const elderlyAssigned = getElderlyForCaregiverOnDay(assignment.user_id, dayName);
            const elderlyNames = elderlyAssigned.length > 0 
              ? elderlyAssigned.join(', ') 
              : 'None';
            
            tableData.push([
              caregiverName,
              `${elderlyAssigned.length}`,
              elderlyNames
            ]);
          });
          
          // Add table - use autoTable function directly
          autoTable(doc, {
            startY: yPosition,
            head: [['Caregiver Name', 'Count', 'Elderly Assigned']],
            body: tableData,
            theme: 'grid',
            headStyles: {
              fillColor: primaryColor,
              textColor: 255,
              fontSize: 10,
              fontStyle: 'bold',
              halign: 'left'
            },
            bodyStyles: {
              fontSize: 9,
              textColor: 0
            },
            columnStyles: {
              0: { cellWidth: 55 },  // Caregiver Name
              1: { cellWidth: 20, halign: 'center' },  // Count
              2: { cellWidth: 'auto' }  // Elderly Assigned
            },
            margin: { left: 10, right: 10 },
            didDrawPage: false // Disable auto page breaks
          });
          
          yPosition = doc.lastAutoTable.finalY + 10;
        }
      }
    }
    
    // ========== FOOTER ON ALL PAGES ==========
    const totalPages = doc.internal.getNumberOfPages();
    
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      
      // Add footer line
      doc.setDrawColor(...lightGray);
      doc.setLineWidth(0.5);
      doc.line(10, pageHeight - 15, pageWidth - 10, pageHeight - 15);
      
      // Add footer text
      doc.setFontSize(8);
      doc.setTextColor(...darkGray);
      doc.setFont('helvetica', 'normal');
      doc.text('ElderLink Care Management System', 15, pageHeight - 8);
      doc.text(`Page ${i} of ${totalPages}`, pageWidth - 15, pageHeight - 8, { align: 'right' });
    }
    
    // ========== SAVE THE PDF ==========
    const fileName = `Caregiver_Schedule_${startDate.replace(/\s/g, '_')}_to_${endDate.replace(/\s/g, '_')}.pdf`;
    doc.save(fileName);
    
    console.log(`✅ PDF exported successfully: ${fileName}`);
    
  } catch (error) {
    console.error('❌ Error exporting PDF:', error);
    throw error;
  }
};

/**
 * Export schedule to Excel format (for future implementation)
 * @param {Object} scheduleData - Complete schedule data
 * @returns {Promise<void>}
 */
export const exportScheduleToExcel = async (scheduleData) => {
  // TODO: Implement Excel export using xlsx library
  console.log('Excel export not yet implemented');
  throw new Error('Excel export feature coming soon!');
};

/**
 * Open print-friendly view (for future implementation)
 * @param {Object} scheduleData - Complete schedule data
 * @returns {Promise<void>}
 */
export const openPrintView = async (scheduleData) => {
  // TODO: Implement print view
  console.log('Print view not yet implemented');
  throw new Error('Print view feature coming soon!');
};
