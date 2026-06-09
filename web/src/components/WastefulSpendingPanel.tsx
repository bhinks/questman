import { AlertTriangle, TrendingDown, ShoppingCart, Repeat, Zap } from 'lucide-react';
import type { WastefulSpending, WastefulPattern } from '../types';
import { format } from 'date-fns';

interface WastefulSpendingPanelProps {
  wastefulSpending: WastefulSpending;
}

export function WastefulSpendingPanel({ wastefulSpending }: WastefulSpendingPanelProps) {
  const getPatternIcon = (type: WastefulPattern['type']) => {
    switch (type) {
      case 'frequent_small':
        return Repeat;
      case 'large_discretionary':
        return ShoppingCart;
      case 'subscription_overlap':
        return TrendingDown;
      case 'impulse_buy':
        return Zap;
      default:
        return AlertTriangle;
    }
  };

  const getPatternColor = (type: WastefulPattern['type']) => {
    switch (type) {
      case 'frequent_small':
        return 'text-orange-600';
      case 'large_discretionary':
        return 'text-red-600';
      case 'subscription_overlap':
        return 'text-purple-600';
      case 'impulse_buy':
        return 'text-yellow-600';
      default:
        return 'text-gray-600';
    }
  };

  const getPatternBg = (type: WastefulPattern['type']) => {
    switch (type) {
      case 'frequent_small':
        return 'bg-orange-50';
      case 'large_discretionary':
        return 'bg-red-50';
      case 'subscription_overlap':
        return 'bg-purple-50';
      case 'impulse_buy':
        return 'bg-yellow-50';
      default:
        return 'bg-gray-50';
    }
  };

  const getPatternTitle = (type: WastefulPattern['type']) => {
    switch (type) {
      case 'frequent_small':
        return 'Frequent Small Purchases';
      case 'large_discretionary':
        return 'Large Discretionary Spending';
      case 'subscription_overlap':
        return 'Subscription Overlaps';
      case 'impulse_buy':
        return 'Impulse Buying';
      default:
        return 'Wasteful Pattern';
    }
  };

  return (
    <div className="space-y-6">
      {/* Overview Card */}
      <div className="bg-gradient-to-r from-red-50 to-orange-50 border border-red-200 rounded-lg p-6">
        <div className="flex items-center space-x-4 mb-4">
          <div className="p-3 bg-red-100 rounded-full">
            <AlertTriangle className="h-6 w-6 text-red-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900">Wasteful Spending Analysis</h2>
            <p className="text-gray-600">
              We've identified ${wastefulSpending.total.toLocaleString()} ({wastefulSpending.percentage.toFixed(1)}%) 
              in potentially wasteful spending patterns
            </p>
          </div>
        </div>
        
        {wastefulSpending.total > 0 && (
          <div className="bg-white rounded-lg p-4 border border-red-200">
            <h3 className="font-medium text-gray-900 mb-2">💡 Quick Wins</h3>
            <p className="text-sm text-gray-600">
              By addressing these patterns, you could potentially save{' '}
              <span className="font-semibold text-green-600">
                ${(wastefulSpending.total * 0.8).toLocaleString()}
              </span>{' '}
              per year.
            </p>
          </div>
        )}
      </div>

      {/* Patterns */}
      {wastefulSpending.patterns.length > 0 ? (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-gray-900">
            Identified Patterns ({wastefulSpending.patterns.length})
          </h3>
          
          {wastefulSpending.patterns.map((pattern, index) => {
            const Icon = getPatternIcon(pattern.type);
            
            return (
              <div 
                key={index} 
                className={`border border-gray-200 rounded-lg p-6 ${getPatternBg(pattern.type)}`}
              >
                <div className="flex items-start space-x-4">
                  <div className={`p-2 rounded-full ${getPatternBg(pattern.type)}`}>
                    <Icon className={`h-5 w-5 ${getPatternColor(pattern.type)}`} />
                  </div>
                  
                  <div className="flex-1">
                    <div className="flex justify-between items-start mb-2">
                      <h4 className="font-medium text-gray-900">
                        {getPatternTitle(pattern.type)}
                      </h4>
                      <span className="text-lg font-bold text-gray-900">
                        ${pattern.amount.toLocaleString()}
                      </span>
                    </div>
                    
                    <p className="text-gray-700 mb-3">{pattern.description}</p>
                    
                    <div className="bg-white rounded-lg p-3 border border-gray-200 mb-4">
                      <h5 className="font-medium text-gray-900 mb-1">💡 Suggestion</h5>
                      <p className="text-sm text-gray-600">{pattern.suggestion}</p>
                    </div>
                    
                    {/* Transaction Details */}
                    <details className="mt-4">
                      <summary className="cursor-pointer text-sm font-medium text-gray-700 hover:text-gray-900">
                        View {pattern.transactions.length} related transactions
                      </summary>
                      <div className="mt-3 space-y-2">
                        {pattern.transactions.slice(0, 10).map((transaction, _txIndex) => (
                          <div 
                            key={transaction.id} 
                            className="flex justify-between items-center text-sm bg-white p-2 rounded border border-gray-100"
                          >
                            <div>
                              <span className="font-medium">{transaction.description}</span>
                              <span className="text-gray-500 ml-2">
                                {format(transaction.date, 'MMM dd, yyyy')}
                              </span>
                            </div>
                            <span className="font-medium text-gray-900">
                              ${Math.abs(transaction.amount).toFixed(2)}
                            </span>
                          </div>
                        ))}
                        {pattern.transactions.length > 10 && (
                          <p className="text-sm text-gray-500 text-center py-2">
                            ... and {pattern.transactions.length - 10} more transactions
                          </p>
                        )}
                      </div>
                    </details>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
          <div className="p-3 bg-green-100 rounded-full w-12 h-12 mx-auto mb-4 flex items-center justify-center">
            <TrendingDown className="h-6 w-6 text-green-600 transform rotate-180" />
          </div>
          <h3 className="text-lg font-medium text-green-900 mb-2">Great job! 🎉</h3>
          <p className="text-green-700">
            We didn't detect any obvious wasteful spending patterns in your data. 
            Your spending habits look quite disciplined!
          </p>
        </div>
      )}
    </div>
  );
}