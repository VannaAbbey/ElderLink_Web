// src/services/elderlyImportService.js
import { db } from "../firebase";
import { collection, addDoc, getDocs } from "firebase/firestore";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";

/**
 * Parse CSV content into array of objects
 * Expected CSV format:
 * First Name, Last Name, Date of Birth, Age, Sex, Mobility Status, Diet Notes, Condition, House ID, Status, Location
 */
export const parseCSV = (csvText) => {
  const lines = csvText.split('\n').filter(line => line.trim());
  if (lines.length < 2) {
    throw new Error("CSV file is empty or has no data rows");
  }

  const headers = lines[0].split(',').map(h => h.trim());
  const requiredHeaders = ['First Name', 'Last Name', 'Date of Birth', 'Age', 'Sex', 'House ID'];
  
  const missingHeaders = requiredHeaders.filter(h => !headers.includes(h));
  if (missingHeaders.length > 0) {
    throw new Error(`Missing required headers: ${missingHeaders.join(', ')}`);
  }

  const elderlyData = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim());
    if (values.length < headers.length) continue; // Skip incomplete rows

    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });

    elderlyData.push({
      elderly_fname: row['First Name'],
      elderly_lname: row['Last Name'],
      elderly_bday: row['Date of Birth'],
      elderly_age: parseInt(row['Age']) || 0,
      elderly_sex: row['Sex'] || 'Male',
      elderly_mobilityStatus: row['Mobility Status'] || 'Independent',
      elderly_dietNotes: row['Diet Notes'] || '',
      elderly_condition: row['Condition'] || '',
      house_id: row['House ID'],
      elderly_status: row['Status'] || 'Alive',
      elderly_location: row['Location'] || '',
    });
  }

  return elderlyData;
};

/**
 * Parse Excel content (requires xlsx library)
 * Install: npm install xlsx
 */
export const parseExcel = async (file) => {
  try {
    const XLSX = await import('xlsx');
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array' });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const jsonData = XLSX.utils.sheet_to_json(firstSheet);

    return jsonData.map(row => ({
      elderly_fname: row['First Name'] || '',
      elderly_lname: row['Last Name'] || '',
      elderly_bday: row['Date of Birth'] || '',
      elderly_age: parseInt(row['Age']) || 0,
      elderly_sex: row['Sex'] || 'Male',
      elderly_mobilityStatus: row['Mobility Status'] || 'Independent',
      elderly_dietNotes: row['Diet Notes'] || '',
      elderly_condition: row['Condition'] || '',
      house_id: row['House ID'] || '',
      elderly_status: row['Status'] || 'Alive',
      elderly_location: row['Location'] || '',
    }));
  } catch (error) {
    console.error("Error parsing Excel:", error);
    throw new Error("Failed to parse Excel file. Make sure xlsx library is installed.");
  }
};

/**
 * Generate next elderly ID
 */
const generateElderlyId = async () => {
  const elderlySnapshot = await getDocs(collection(db, "elderly"));
  const numbers = elderlySnapshot.docs
    .map((doc) => parseInt(doc.data().elderly_id?.replace("E", "")))
    .filter((n) => !isNaN(n));
  const nextNum = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
  return `E${String(nextNum).padStart(3, "0")}`;
};

/**
 * Validate elderly data
 */
const validateElderlyData = (elderly) => {
  const errors = [];
  
  if (!elderly.elderly_fname) errors.push("First name is required");
  if (!elderly.elderly_lname) errors.push("Last name is required");
  if (!elderly.elderly_bday) errors.push("Date of birth is required");
  if (!elderly.elderly_age || elderly.elderly_age <= 0) errors.push("Valid age is required");
  if (!elderly.house_id) errors.push("House ID is required");
  if (!['Male', 'Female'].includes(elderly.elderly_sex)) errors.push("Sex must be Male or Female");
  
  return errors;
};

/**
 * Import elderly data into Firestore
 */
export const importElderlyToFirestore = async (elderlyArray, onProgress) => {
  const results = {
    success: 0,
    failed: 0,
    errors: [],
  };

  for (let i = 0; i < elderlyArray.length; i++) {
    const elderly = elderlyArray[i];
    
    // Validate data
    const validationErrors = validateElderlyData(elderly);
    if (validationErrors.length > 0) {
      results.failed++;
      results.errors.push({
        row: i + 2, // +2 because of header row and 0-indexing
        name: `${elderly.elderly_fname} ${elderly.elderly_lname}`,
        errors: validationErrors,
      });
      if (onProgress) onProgress(i + 1, elderlyArray.length);
      continue;
    }

    try {
      const elderlyId = await generateElderlyId();
      
      await addDoc(collection(db, "elderly"), {
        elderly_id: elderlyId,
        elderly_fname: elderly.elderly_fname,
        elderly_lname: elderly.elderly_lname,
        elderly_bday: elderly.elderly_bday,
        elderly_age: elderly.elderly_age,
        elderly_sex: elderly.elderly_sex,
        elderly_mobilityStatus: elderly.elderly_mobilityStatus,
        elderly_dietNotes: elderly.elderly_dietNotes,
        elderly_condition: elderly.elderly_condition,
        house_id: elderly.house_id,
        elderly_status: elderly.elderly_status,
        elderly_location: elderly.elderly_location,
        elderly_img: "", // Default empty, can be updated later
      });

      results.success++;
    } catch (error) {
      console.error(`Error importing elderly ${i + 1}:`, error);
      results.failed++;
      results.errors.push({
        row: i + 2,
        name: `${elderly.elderly_fname} ${elderly.elderly_lname}`,
        errors: [error.message],
      });
    }

    if (onProgress) onProgress(i + 1, elderlyArray.length);
  }

  return results;
};

/**
 * Download CSV template
 */
export const downloadCSVTemplate = () => {
  const headers = [
    'First Name',
    'Last Name',
    'Date of Birth',
    'Age',
    'Sex',
    'Mobility Status',
    'Diet Notes',
    'Condition',
    'House ID',
    'Status',
    'Location'
  ];
  
  const sampleRow = [
    'John',
    'Doe',
    '1940-05-15',
    '84',
    'Male',
    'Independent',
    'No dairy',
    'Diabetes',
    'H001',
    'Alive',
    ''
  ];

  const csv = headers.join(',') + '\n' + sampleRow.join(',');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'elderly_import_template.csv';
  a.click();
  window.URL.revokeObjectURL(url);
};
