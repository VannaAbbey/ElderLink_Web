import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

if (jsPDF && jsPDF.API && !jsPDF.API.autoTable) {
  jsPDF.API.autoTable = autoTable;
}

/**
 * Export medication records to PDF
 * @param {Object} params - { rows, showAll, selectedDate, statusFilter }
 */
export const exportMedicationRecordsToPDF = async ({ rows = [], showAll = false, selectedDate = '', statusFilter = 'all' }) => {
  try {
    if (!rows || rows.length === 0) {
      throw new Error('No medication records to export.');
    }

    const doc = new jsPDF('l', 'mm', 'a4');
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    const primaryColor = [30, 58, 95];
    const lightGray = [245, 245, 245];
    const darkGray = [100, 100, 100];

    // Header
    doc.setFillColor(...primaryColor);
    doc.rect(0, 0, pageWidth, 40, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.text('MEDICATION RECORD', pageWidth / 2, 18, { align: 'center' });

    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.text('ElderLink Care Management System', pageWidth / 2, 30, { align: 'center' });

    // Filter info
    let filterText = 'All Records';
    if (!showAll && selectedDate) {
      const d = new Date(selectedDate);
      filterText = `Records for ${d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;
    }
    if (statusFilter && statusFilter !== 'all') {
      filterText += ` \u2022 Status: ${statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)}`;
    }

    doc.setFillColor(...lightGray);
    doc.roundedRect(15, 50, pageWidth - 30, 18, 3, 3, 'F');
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('Report Period:', 20, 58);
    doc.setFont('helvetica', 'normal');
    doc.text(filterText, 60, 58);

    doc.setFont('helvetica', 'bold');
    doc.text('Total Records:', pageWidth - 80, 58);
    doc.setFont('helvetica', 'normal');
    doc.text(String(rows.length), pageWidth - 40, 58);

    let yPos = 76;

    // Table
    const tableData = rows.map(r => [
      r.nurseName || 'Unknown',
      r.elderlyName || 'Unknown',
      r.medicationName || 'Unknown',
      r.takeLabel || '-',
      r.time || '-',
      r.status || 'pending'
    ]);

    autoTable(doc, {
      startY: yPos,
      head: [['Nurse', 'Elderly', 'Medication', 'Take', 'Time', 'Status']],
      body: tableData,
      theme: 'grid',
      headStyles: { fillColor: primaryColor, textColor: 255, fontSize: 10, fontStyle: 'bold' },
      bodyStyles: { fontSize: 9 },
      columnStyles: {
        0: { cellWidth: 50 },
        1: { cellWidth: 50 },
        2: { cellWidth: 70 },
        3: { cellWidth: 30, halign: 'center' },
        4: { cellWidth: 30, halign: 'center' },
        5: { cellWidth: 30, halign: 'center' }
      },
      margin: { left: 15, right: 15 },
      alternateRowStyles: { fillColor: [250, 250, 250] },
      didDrawPage: function (data) {
        const pageCount = doc.internal.getNumberOfPages();
        const currentPage = doc.internal.getCurrentPageInfo().pageNumber;
        doc.setFontSize(8);
        doc.setTextColor(...darkGray);
        doc.text(`Page ${currentPage} of ${pageCount}`, pageWidth - 15, pageHeight - 8, { align: 'right' });
      }
    });

    // ===== SUMMARY: per-medication totals & unique elderly counts =====
    const medSummaryMap = {};
    const globalElderlySet = new Set();

    rows.forEach(r => {
      const medKey = r.medicationId || r.medicationName || 'Unknown Medication';
      const elderlyKey = r.elderlyId || r.elderlyName || `${r.elderlyName || 'Unknown'}_${Math.random()}`;
      globalElderlySet.add(elderlyKey);

      if (!medSummaryMap[medKey]) {
        medSummaryMap[medKey] = {
          medicationName: r.medicationName || medKey,
          totalTakes: 0,
          elderlySet: new Set()
        };
      }
      medSummaryMap[medKey].totalTakes += 1;
      medSummaryMap[medKey].elderlySet.add(elderlyKey);
    });

    const summaryRows = Object.values(medSummaryMap).map(m => [
      m.medicationName,
      String(m.totalTakes),
      String(m.elderlySet.size)
    ]);

    // Add summary page
    doc.addPage();
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('MEDICATION SUMMARY', pageWidth / 2, 20, { align: 'center' });
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.text(`Generated: ${new Date().toLocaleString('en-US')}`, pageWidth - 15, 26, { align: 'right' });

    let summaryStartY = 36;
    doc.setFillColor(...lightGray);
    doc.roundedRect(15, summaryStartY, pageWidth - 30, 18, 3, 3, 'F');
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'bold');
    doc.text('Total Records:', 20, summaryStartY + 12);
    doc.setFont('helvetica', 'normal');
    doc.text(String(rows.length), 60, summaryStartY + 12);

    doc.setFont('helvetica', 'bold');
    doc.text('Elderly (total):', pageWidth / 2 - 10, summaryStartY + 12);
    doc.setFont('helvetica', 'normal');
    doc.text(String(globalElderlySet.size), pageWidth / 2 + 60, summaryStartY + 12);

    summaryStartY += 30;

    autoTable(doc, {
      startY: summaryStartY,
      head: [['Medication', 'Total Takes', 'Elderly']],
      body: summaryRows,
      theme: 'grid',
      headStyles: { fillColor: primaryColor, textColor: 255, fontSize: 10, fontStyle: 'bold' },
      bodyStyles: { fontSize: 9 },
      columnStyles: {
        // Make summary table spread to roughly the same visual width as the main table
        0: { cellWidth: 150 },
        1: { cellWidth: 60, halign: 'center' },
        2: { cellWidth: 60, halign: 'center' }
      },
      margin: { left: 15, right: 15 },
      alternateRowStyles: { fillColor: [250, 250, 250] }
    });

    // Footer on all pages
    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setDrawColor(...lightGray);
      doc.setLineWidth(0.5);
      doc.line(10, pageHeight - 12, pageWidth - 10, pageHeight - 12);
      doc.setFontSize(8);
      doc.setTextColor(...darkGray);
      doc.setFont('helvetica', 'normal');
      doc.text('ElderLink Care Management System - Medication Record', 15, pageHeight - 6);
      doc.text(`Generated: ${new Date().toLocaleString('en-US')}`, pageWidth - 15, pageHeight - 6, { align: 'right' });
    }

    // Save
    const dateStr = showAll ? 'All_Records' : (selectedDate ? new Date(selectedDate).toLocaleDateString('en-US').replace(/\//g, '-') : 'Medication');
    const fileName = `Medication_Record_${dateStr}.pdf`;
    doc.save(fileName);

  } catch (err) {
    console.error('Error exporting medication records to PDF', err);
    throw err;
  }
};

/**
 * Export medication records to CSV (Excel-friendly)
 * @param {Object} params - { rows, showAll, selectedDate, statusFilter }
 */
export const exportMedicationRecordsToCSV = ({ rows = [], showAll = false, selectedDate = '', statusFilter = 'all' }) => {
  try {
    if (!rows || rows.length === 0) {
      throw new Error('No medication records to export.');
    }

    // CSV header
    const header = ['Nurse', 'Elderly', 'Medication', 'Take', 'Time', 'Status'];

    const lines = [header.join(',')];

    rows.forEach(r => {
      const nurse = (r.nurseName || '').replace(/"/g, '""');
      const elderly = (r.elderlyName || '').replace(/"/g, '""');
      const med = (r.medicationName || '').replace(/"/g, '""');
      const take = (r.takeLabel || '').replace(/"/g, '""');
      const time = (r.time || '').replace(/"/g, '""');
      const status = (r.status || '').replace(/"/g, '""');

      // Wrap fields that contain commas or quotes in double quotes
      const row = [nurse, elderly, med, take, time, status].map(f => {
        if (f == null) return '';
        const s = String(f);
        return /[",\n]/.test(s) ? `"${s}"` : s;
      });

      lines.push(row.join(','));
    });

    const csvContent = '\uFEFF' + lines.join('\n'); // BOM for Excel compatibility
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const dateStr = showAll ? 'All_Records' : (selectedDate ? new Date(selectedDate).toLocaleDateString('en-US').replace(/\//g, '-') : 'Medication');
    const fileName = `Medication_Record_${dateStr}.csv`;

    const a = document.createElement('a');
    a.href = url;
    a.setAttribute('download', fileName);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

  } catch (err) {
    console.error('Error exporting medication records to CSV', err);
    throw err;
  }
};
