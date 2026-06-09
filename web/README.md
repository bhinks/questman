# Questman — Finance Module (originally FinDash)

> **Note:** This README describes the financial dashboard module, which is the
> original FinDash app that became the seed for [Questman](../README.md) — a
> gamified personal life hub spanning finance, workouts, chores, and habits.
> The finance-specific features below still apply to the Finance tab.

A comprehensive financial analysis tool that helps you understand your spending patterns, identify wasteful habits, and make better financial decisions.

## Features

### 📊 **Interactive Visualizations**
- Monthly and daily spending trends
- Category breakdown with pie and bar charts
- Drill-down capabilities for detailed analysis
- Multiple chart types (line, area, bar)

### 🏷️ **Smart Categorization**
- Automatic transaction categorization using intelligent rules
- Manual category editing and custom rules
- Vendor identification and grouping
- Income vs. expense classification

### 🚨 **Wasteful Spending Detection**
- **Frequent Small Purchases**: Identifies multiple small transactions at the same vendor
- **Large Discretionary Spending**: Flags significant non-essential purchases
- **Subscription Overlaps**: Detects redundant streaming/music services
- **Impulse Buying**: Finds rapid purchase patterns that suggest impulse shopping

### 🔍 **Advanced Filtering & Search**
- Filter by date range, amount, category, or search term
- Real-time transaction filtering
- Multiple filter combinations

### 📋 **Transaction Management**
- Edit transaction details (description, vendor, category, amount)
- Sortable and paginated transaction table
- Bulk operations support

## Getting Started

### Prerequisites
- Node.js 18+ 
- npm or yarn

### Installation

1. **Clone or download the project**
   ```bash
   cd web
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start the development server**
   ```bash
   npm run dev
   ```

4. **Open your browser** and navigate to `http://localhost:5173`

### Building for Production

```bash
npm run build
```

The built files will be in the `dist/` directory.

## Usage

### 1. **Upload Your Data**

The application accepts CSV or Excel files (.csv, .xlsx, .xls) with three required columns:

| Column | Description | Example |
|--------|-------------|---------|
| **Date** | Transaction date | 2024-01-15, 01/15/2024, January 15, 2024 |
| **Description** | Transaction description | "STARBUCKS SEATTLE WA", "Amazon.com purchase" |
| **Amount** | Transaction amount | -4.50 (expense), +2500.00 (income) |

**Supported date formats**: Most common date formats are automatically detected
**Amount format**: Negative for expenses, positive for income. Currency symbols and commas are automatically handled.

### 2. **Explore Your Data**

Once uploaded, you'll see:

- **Overview Cards**: Total spent, income, net amount, and averages
- **Spending Trends**: Interactive charts showing spending over time
- **Category Analysis**: See where your money goes
- **Wasteful Spending**: AI-powered insights into potentially wasteful patterns

### 3. **Use Filters**

- **Search**: Find specific vendors or transaction types
- **Date Range**: Focus on specific time periods
- **Amount Range**: Filter by transaction size
- **Categories**: View specific spending categories

### 4. **Drill Down**

- Click on chart segments to filter by category
- Click on vendor names to see all transactions
- Use the transaction table to edit details

### 5. **Review Wasteful Spending**

The "Wasteful Spending" tab provides:
- **Automatic detection** of potentially wasteful patterns
- **Actionable suggestions** for improvement
- **Detailed transaction lists** for each pattern
- **Estimated savings** if patterns are addressed

## Example Data Formats

### CSV Example
```csv
Date,Description,Amount
2024-01-15,STARBUCKS COFFEE 123 MAIN ST,-4.50
2024-01-15,SALARY DEPOSIT COMPANY ABC,2500.00
2024-01-16,AMAZON.COM PURCHASE,-29.99
```

### Excel Example
| Date | Description | Amount |
|------|-------------|--------|
| 1/15/2024 | Starbucks Coffee | -4.50 |
| 1/15/2024 | Salary Deposit | 2500.00 |
| 1/16/2024 | Amazon Purchase | -29.99 |

## Tips for Best Results

1. **Clean Data**: Ensure consistent date formats and vendor names
2. **Complete History**: Upload 3+ months of data for better pattern detection
3. **Regular Updates**: Re-upload data monthly to track trends
4. **Review Categories**: Check auto-categorization and adjust as needed
5. **Act on Insights**: Use wasteful spending suggestions to improve your finances

## Technology Stack

- **Frontend**: React 18 + TypeScript
- **Styling**: Tailwind CSS
- **Charts**: Recharts
- **Data Processing**: Papa Parse (CSV), SheetJS (Excel)
- **Build Tool**: Vite
- **Date Handling**: date-fns

## Privacy & Security

- **Local Processing**: All data processing happens in your browser
- **No Server Storage**: Your financial data never leaves your device
- **No Tracking**: No analytics or tracking of your financial information
- **Open Source**: Full transparency in how your data is handled

## Troubleshooting

### Common Issues

**"Required columns not found"**
- Ensure your file has columns named Date, Description, and Amount (case-insensitive)
- Check that your file isn't empty

**"Invalid date" errors**
- Verify date formats are consistent
- Common formats: MM/DD/YYYY, YYYY-MM-DD, DD/MM/YYYY

**"Invalid amount" errors**
- Remove any extra currency symbols or formatting
- Use negative numbers for expenses, positive for income

**Categories not detected properly**
- Use the transaction table to manually correct categories
- The system learns from your corrections

### Performance Tips

- For files with 10,000+ transactions, consider breaking them into smaller chunks
- Clear browser cache if experiencing display issues
- Use filters to work with subsets of large datasets

## Contributing

This is a self-contained financial analysis tool. Feel free to:
- Fork the project for your own modifications
- Add new categorization rules
- Improve the wasteful spending detection algorithms
- Add new visualization types

## License

MIT License - feel free to use and modify as needed.

---

**Disclaimer**: This tool is for analysis purposes only and should not be considered financial advice. Always consult with financial professionals for important financial decisions.
