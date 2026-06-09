import { useState, useMemo } from 'react';
import type { Transaction, FilterOptions, SpendingAnalysis } from '../types';
import { analyzeSpending, getMonthlySpending, getDailySpending } from '../utils/analyzer';
import { categorizeTransactions } from '../utils/categorizer';
import { OverviewCards } from './OverviewCards';
import { SpendingChart } from './SpendingChart';
import { CategoryChart } from './CategoryChart';
import { TransactionTable } from './TransactionTable';
import { WastefulSpendingPanel } from './WastefulSpendingPanel';
import { FilterPanel } from './FilterPanel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './Tabs';

interface DashboardProps {
  initialTransactions: Transaction[];
}

export function Dashboard({ initialTransactions }: DashboardProps) {
  const [transactions, setTransactions] = useState(() => 
    categorizeTransactions(initialTransactions)
  );
  const [filters, setFilters] = useState<FilterOptions>({});
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const analysis: SpendingAnalysis = useMemo(() => 
    analyzeSpending(transactions, filters), 
    [transactions, filters]
  );
  
  const monthlyData = useMemo(() => 
    getMonthlySpending(transactions), 
    [transactions]
  );
  
  const dailyData = useMemo(() => 
    getDailySpending(transactions), 
    [transactions]
  );

  const filteredTransactions = useMemo(() => {
    let filtered = transactions;
    
    if (filters.dateRange) {
      filtered = filtered.filter(t => 
        t.date >= filters.dateRange!.start && t.date <= filters.dateRange!.end
      );
    }
    
    if (filters.categories?.length) {
      filtered = filtered.filter(t => 
        filters.categories!.includes(t.category || 'Uncategorized')
      );
    }
    
    if (filters.minAmount !== undefined) {
      filtered = filtered.filter(t => Math.abs(t.amount) >= filters.minAmount!);
    }
    
    if (filters.maxAmount !== undefined) {
      filtered = filtered.filter(t => Math.abs(t.amount) <= filters.maxAmount!);
    }
    
    if (filters.searchTerm) {
      const searchLower = filters.searchTerm.toLowerCase();
      filtered = filtered.filter(t => 
        t.description.toLowerCase().includes(searchLower) ||
        t.vendor?.toLowerCase().includes(searchLower) ||
        t.category?.toLowerCase().includes(searchLower)
      );
    }
    
    return filtered;
  }, [transactions, filters]);

  const handleCategoryClick = (category: string) => {
    setSelectedCategory(category === selectedCategory ? null : category);
    if (category !== selectedCategory) {
      setFilters(prev => ({ ...prev, categories: [category] }));
    } else {
      setFilters(prev => ({ ...prev, categories: undefined }));
    }
  };

  const handleTransactionUpdate = (updatedTransaction: Transaction) => {
    setTransactions(prev => 
      prev.map(t => t.id === updatedTransaction.id ? updatedTransaction : t)
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold text-gray-900">Financial Dashboard</h1>
          <div className="text-sm text-gray-600">
            {filteredTransactions.length} of {transactions.length} transactions
          </div>
        </div>

        <FilterPanel 
          transactions={transactions}
          filters={filters}
          onFiltersChange={setFilters}
        />

        <OverviewCards analysis={analysis} />

        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="categories">Categories</TabsTrigger>
            <TabsTrigger value="wasteful">Wasteful Spending</TabsTrigger>
            <TabsTrigger value="transactions">Transactions</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <SpendingChart 
                monthlyData={monthlyData}
                dailyData={dailyData}
              />
              <CategoryChart 
                categories={analysis.topCategories.slice(0, 8)}
                onCategoryClick={handleCategoryClick}
                selectedCategory={selectedCategory}
              />
            </div>
          </TabsContent>

          <TabsContent value="categories" className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2">
                <CategoryChart 
                  categories={analysis.topCategories}
                  onCategoryClick={handleCategoryClick}
                  selectedCategory={selectedCategory}
                  showAll={true}
                />
              </div>
              <div className="bg-white p-6 rounded-lg shadow">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Top Vendors</h3>
                <div className="space-y-3">
                  {analysis.topVendors.slice(0, 10).map((vendor, _index) => (
                    <div key={vendor.vendor} className="flex justify-between items-center">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {vendor.vendor}
                        </p>
                        <p className="text-xs text-gray-500">{vendor.category}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-gray-900">
                          ${vendor.amount.toFixed(2)}
                        </p>
                        <p className="text-xs text-gray-500">
                          {vendor.transactions} transactions
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="wasteful" className="space-y-6">
            <WastefulSpendingPanel wastefulSpending={analysis.wastefulSpending} />
          </TabsContent>

          <TabsContent value="transactions" className="space-y-6">
            <TransactionTable 
              transactions={filteredTransactions}
              onTransactionUpdate={handleTransactionUpdate}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}