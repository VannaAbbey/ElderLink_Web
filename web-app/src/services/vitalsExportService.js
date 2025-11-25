import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

if (jsPDF && jsPDF.API && !jsPDF.API.autoTable) {
  jsPDF.API.autoTable = autoTable;
}

/**
 * Export vitals records to PDF
 * @param {Object} params - { rows, showAll, selectedDate, statusFilter }
 */
export const exportVitalsToPDF = async ({ rows = [], showAll = false, selectedDate = '', statusFilter = 'all' }) => {
  try {
    if (!rows || rows.length === 0) {
      throw new Error('No vitals records to export.');
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
    doc.text('VITAL MONITORING RECORD', pageWidth / 2, 18, { align: 'center' });

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
      filterText += ` \u007F Status: ${statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)}`;
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
      r.bloodPressure || '-',
      r.pulse || '-',
      r.temperature || '-',
      r.respiratoryRate || '-',
      r.oxygenSaturation || '-',
      r.status || 'pending'
    ]);

    // Compute responsive column widths so columns fit the printable area.
    // We'll distribute available width proportionally and then scale if rounding/mins push beyond available.
    const margin = { left: 15, right: 15 };
    const availableWidth = pageWidth - margin.left - margin.right;
    // Revised column distribution prioritizing Status (last column) while keeping Nurse/Elderly reasonable
    const colPercents = [0.14, 0.18, 0.07, 0.06, 0.07, 0.07, 0.07, 0.34];
    // initial raw widths
    const rawWidths = colPercents.map(p => availableWidth * p);
    // enforce a small minimum, but allow scaling down if needed
    const minWidths = [40, 50, 28, 24, 28, 28, 28, 60];
    let colWidths = rawWidths.map((w, i) => Math.max(minWidths[i], Math.round(w)));
    // if sum exceeds availableWidth (due to minWidths), scale everything down proportionally
    const sumWidths = colWidths.reduce((s, v) => s + v, 0);
    if (sumWidths > availableWidth) {
      const scale = availableWidth / sumWidths;
      colWidths = colWidths.map(w => Math.max(20, Math.floor(w * scale)));
    }

    autoTable(doc, {
      startY: yPos,
      head: [['Nurse', 'Elderly', 'BP', 'Pulse', 'Temp', 'RR', 'O2 Sat', 'Status']],
      body: tableData,
      theme: 'grid',
      tableWidth: 'auto',
      headStyles: { fillColor: primaryColor, textColor: 255, fontSize: 9, fontStyle: 'bold' },
      bodyStyles: { fontSize: 9, valign: 'middle' },
      columnStyles: {
        0: { cellWidth: colWidths[0] },
        1: { cellWidth: colWidths[1] },
        2: { cellWidth: colWidths[2], halign: 'center' },
        3: { cellWidth: colWidths[3], halign: 'center' },
        4: { cellWidth: colWidths[4], halign: 'center' },
        5: { cellWidth: colWidths[5], halign: 'center' },
        6: { cellWidth: colWidths[6], halign: 'center' },
        7: { cellWidth: colWidths[7], halign: 'left', overflow: 'linebreak' }
      },
      margin,
      styles: { cellPadding: 3 },
      alternateRowStyles: { fillColor: [250, 250, 250] },
      didDrawPage: function (data) {
        const pageCount = doc.internal.getNumberOfPages();
        const currentPage = doc.internal.getCurrentPageInfo().pageNumber;
        doc.setFontSize(8);
        doc.setTextColor(...darkGray);
        doc.text(`Page ${currentPage} of ${pageCount}`, pageWidth - 15, pageHeight - 8, { align: 'right' });
      }
    });

    // Summary page removed per user request: only main table will be exported.

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
      doc.text('ElderLink Care Management System - Vital Monitoring', 15, pageHeight - 6);
      doc.text(`Generated: ${new Date().toLocaleString('en-US')}`, pageWidth - 15, pageHeight - 6, { align: 'right' });
    }

    // Save
    const dateStr = showAll ? 'All_Records' : (selectedDate ? new Date(selectedDate).toLocaleDateString('en-US').replace(/\//g, '-') : 'Vitals');
    const fileName = `Vital_Monitoring_Record_${dateStr}.pdf`;
    doc.save(fileName);

  } catch (err) {
    console.error('Error exporting vitals records to PDF', err);
    throw err;
  }
};

/**
 * Export vitals records to CSV (Excel-friendly)
 * @param {Object} params - { rows, showAll, selectedDate, statusFilter }
 */
export const exportVitalsToCSV = async ({ rows = [], showAll = false, selectedDate = '', statusFilter = 'all' }) => {
  try {
    if (!rows || rows.length === 0) throw new Error('No vitals records to export.');

    // Build CSV header and rows
    const header = ['Nurse', 'Elderly', 'BP', 'Pulse', 'Temp', 'RR', 'O2 Sat', 'Status'];
    const bodyRows = rows.map(r => [
      (r.nurseName || 'Unknown').replace(/"/g, '""'),
      (r.elderlyName || 'Unknown').replace(/"/g, '""'),
      (r.bloodPressure || '-').toString().replace(/"/g, '""'),
      (r.pulse || '-').toString().replace(/"/g, '""'),
      (r.temperature || '-').toString().replace(/"/g, '""'),
      (r.respiratoryRate || '-').toString().replace(/"/g, '""'),
      (r.oxygenSaturation || '-').toString().replace(/"/g, '""'),
      (r.status || 'pending').toString().replace(/"/g, '""')
    ]);

    const csvLines = [];
    csvLines.push('"' + header.join('","') + '"');
    bodyRows.forEach(cols => {
      csvLines.push('"' + cols.join('","') + '"');
    });

    const csvContent = csvLines.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const dateStr = showAll ? 'All_Records' : (selectedDate ? new Date(selectedDate).toLocaleDateString('en-US').replace(/\//g, '-') : 'Vitals');
    const fileName = `Vital_Monitoring_Record_${dateStr}.csv`;

    if (navigator.msSaveBlob) { // IE 10+
      navigator.msSaveBlob(blob, fileName);
    } else {
      const link = document.createElement('a');
      if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', fileName);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }
    }

  } catch (err) {
    console.error('Error exporting vitals to CSV', err);
    throw err;
  }
};
