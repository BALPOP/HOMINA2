# Admin Dashboard - CSV Data Instructions

## 🚀 **FIXED! No more Google Sheets API issues!**

The admin dashboard now loads data from **local CSV files** instead of Google Sheets. This eliminates all CORS and authentication problems.

## 📁 **Data Files Location**
All data files are in the `admin/data/` folder:
- `entries.csv` - Lottery entries data
- `results.csv` - Contest results data
- `recharge-popluz.csv` - POPLUZ recharge data
- `recharge-popn1.csv` - POPN1 recharge data

## 🔄 **How to Update Data**

### **Step 1: Export from Google Sheets**
1. Open your Google Sheet
2. Go to **File → Download → Comma-separated values (.csv)**
3. Save the file

### **Step 2: Update Local Files**
1. Replace the corresponding CSV file in `admin/data/` folder
2. Refresh the admin dashboard

### **Step 3: File Mappings**
- **ENTRIES Sheet** → `admin/data/entries.csv`
- **RESULTS Sheet** → `admin/data/results.csv`
- **RECHARGE POPLUZ** → `admin/data/recharge-popluz.csv`
- **RECHARGE POPN1** → `admin/data/recharge-popn1.csv`

## ✅ **Current Sample Data**
The dashboard is currently loaded with your sample data from the sheets you provided.

## 🎯 **Benefits**
- ✅ **No CORS issues**
- ✅ **No authentication required**
- ✅ **Works offline**
- ✅ **Fast loading**
- ✅ **Easy to update**

Just export your CSVs normally and replace the files! 🎉