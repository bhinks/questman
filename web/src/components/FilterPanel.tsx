import { Search, Calendar, DollarSign, Tag, X } from 'lucide-react';
import type { FilterOptions, Transaction } from '../types';
import { getUniqueCategories } from '../utils/categorizer';
import { format } from 'date-fns';

interface FilterPanelProps {
  transactions: Transaction[];
  filters: FilterOptions;
  onFiltersChange: (filters: FilterOptions) => void;
}

export function FilterPanel({ transactions, filters, onFiltersChange }: FilterPanelProps) {
  const categories = getUniqueCategories(transactions);
  const hasActiveFilters = Object.values(filters).some(value => 
    value !== undefined && value !== null && 
    (Array.isArray(value) ? value.length > 0 : true)
  );

  const handleDateRangeChange = (field: 'start' | 'end', value: string) => {
    const date = new Date(value);
    const currentRange = filters.dateRange || { start: new Date(), end: new Date() };
    
    onFiltersChange({
      ...filters,
      dateRange: {
        ...currentRange,
        [field]: date
      }
    });
  };

  const handleCategoryToggle = (category: string) => {
    const currentCategories = filters.categories || [];
    const newCategories = currentCategories.includes(category)
      ? currentCategories.filter(c => c !== category)
      : [...currentCategories, category];
    
    onFiltersChange({
      ...filters,
      categories: newCategories.length > 0 ? newCategories : undefined
    });
  };

  const clearFilters = () => {
    onFiltersChange({});
  };

  const clearFilter = (filterKey: keyof FilterOptions) => {
    const newFilters = { ...filters };
    delete newFilters[filterKey];
    onFiltersChange(newFilters);
  };

  // Get date range for inputs
  const allDates = transactions.map(t => t.date);
  const minDate = allDates.length > 0 ? new Date(Math.min(...allDates.map(d => d.getTime()))) : new Date();
  const maxDate = allDates.length > 0 ? new Date(Math.max(...allDates.map(d => d.getTime()))) : new Date();

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 flex items-center space-x-2">
          <Search className="h-5 w-5" />
          <span>Filters</span>
        </h3>
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="text-sm text-red-600 hover:text-red-800 flex items-center space-x-1"
          >
            <X className="h-4 w-4" />
            <span>Clear all</span>
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Search */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">
            Search
          </label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Description, vendor..."
              value={filters.searchTerm || ''}
              onChange={(e) => onFiltersChange({ 
                ...filters, 
                searchTerm: e.target.value || undefined 
              })}
              className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>

        {/* Date Range */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700 flex items-center space-x-1">
            <Calendar className="h-4 w-4" />
            <span>Date Range</span>
          </label>
          <div className="space-y-1">
            <input
              type="date"
              value={filters.dateRange?.start ? format(filters.dateRange.start, 'yyyy-MM-dd') : ''}
              min={format(minDate, 'yyyy-MM-dd')}
              max={format(maxDate, 'yyyy-MM-dd')}
              onChange={(e) => handleDateRangeChange('start', e.target.value)}
              className="w-full px-3 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="Start date"
            />
            <input
              type="date"
              value={filters.dateRange?.end ? format(filters.dateRange.end, 'yyyy-MM-dd') : ''}
              min={format(minDate, 'yyyy-MM-dd')}
              max={format(maxDate, 'yyyy-MM-dd')}
              onChange={(e) => handleDateRangeChange('end', e.target.value)}
              className="w-full px-3 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="End date"
            />
          </div>
        </div>

        {/* Amount Range */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700 flex items-center space-x-1">
            <DollarSign className="h-4 w-4" />
            <span>Amount Range</span>
          </label>
          <div className="space-y-1">
            <input
              type="number"
              placeholder="Min amount"
              value={filters.minAmount || ''}
              onChange={(e) => onFiltersChange({ 
                ...filters, 
                minAmount: e.target.value ? parseFloat(e.target.value) : undefined 
              })}
              className="w-full px-3 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <input
              type="number"
              placeholder="Max amount"
              value={filters.maxAmount || ''}
              onChange={(e) => onFiltersChange({ 
                ...filters, 
                maxAmount: e.target.value ? parseFloat(e.target.value) : undefined 
              })}
              className="w-full px-3 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Categories */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700 flex items-center space-x-1">
            <Tag className="h-4 w-4" />
            <span>Categories</span>
          </label>
          <div className="max-h-24 overflow-y-auto space-y-1">
            {categories.map(category => (
              <label key={category} className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={filters.categories?.includes(category) || false}
                  onChange={() => handleCategoryToggle(category)}
                  className="h-3 w-3 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <span className="text-xs text-gray-700 truncate">{category}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Active Filters Display */}
      {hasActiveFilters && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          <div className="flex flex-wrap gap-2">
            {filters.searchTerm && (
              <div className="flex items-center space-x-1 bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-xs">
                <span>Search: "{filters.searchTerm}"</span>
                <button onClick={() => clearFilter('searchTerm')}>
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
            
            {filters.dateRange && (
              <div className="flex items-center space-x-1 bg-green-100 text-green-800 px-2 py-1 rounded-full text-xs">
                <span>
                  {format(filters.dateRange.start, 'MMM dd')} - {format(filters.dateRange.end, 'MMM dd')}
                </span>
                <button onClick={() => clearFilter('dateRange')}>
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
            
            {(filters.minAmount !== undefined || filters.maxAmount !== undefined) && (
              <div className="flex items-center space-x-1 bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full text-xs">
                <span>
                  ${filters.minAmount || '0'} - ${filters.maxAmount || '∞'}
                </span>
                <button onClick={() => onFiltersChange({ 
                  ...filters, 
                  minAmount: undefined, 
                  maxAmount: undefined 
                })}>
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
            
            {filters.categories?.map(category => (
              <div key={category} className="flex items-center space-x-1 bg-purple-100 text-purple-800 px-2 py-1 rounded-full text-xs">
                <span>{category}</span>
                <button onClick={() => handleCategoryToggle(category)}>
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}