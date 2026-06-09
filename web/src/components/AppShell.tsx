import { useState, useEffect } from 'react';
import { Icon } from './Icon';
import { Brandmark } from './Brandmark';
import type { SpendingAnalysis } from '../types';

interface AppShellProps {
  analysis?: SpendingAnalysis;
  activeTab: string;
  onTabChange: (tab: string) => void;
  children: React.ReactNode;
  onUpload: () => void;
}

interface NavItem {
  id: string;
  label: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'today', label: 'Today', icon: 'target' },
  { id: 'habits', label: 'Habits', icon: 'check' },
  { id: 'chores', label: 'Chores', icon: 'list' },
  { id: 'workouts', label: 'Workouts', icon: 'spark' },
  { id: 'projects', label: 'Projects', icon: 'grid' },
  { id: 'media', label: 'Media', icon: 'play' },
  { id: 'vitals', label: 'Vitals', icon: 'heart' },
  { id: 'social', label: 'Social', icon: 'flag' },
  { id: 'progress', label: 'Progress', icon: 'layers' },
  // Finance group (existing dashboard)
  { id: 'overview', label: 'Finance', icon: 'grid' },
  { id: 'categories', label: 'Categories', icon: 'layers' },
  { id: 'savings', label: 'Savings', icon: 'target' },
  { id: 'transactions', label: 'Transactions', icon: 'list' },
];

function Clock() {
  const [time, setTime] = useState(new Date());
  
  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);
  
  return (
    <span 
      className="mono" 
      style={{ 
        fontSize: 11.5, 
        color: 'var(--text-dim)', 
        letterSpacing: '0.05em' 
      }}
    >
      {time.toLocaleTimeString('en-US', { hour12: false })}
    </span>
  );
}

export function AppShell({ analysis, activeTab, onTabChange, children, onUpload }: AppShellProps) {
  const reclaimTotal = analysis?.wastefulSpending.total || 0;

  return (
    <div className="app-shell">
      {/* LEFT NAV RAIL (desktop) */}
      <aside className="nav-rail">
        <div style={{ padding: '20px 18px 18px' }}>
          <Brandmark />
        </div>
        
        <nav style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          gap: 4, 
          padding: '8px 12px', 
          flex: 1 
        }}>
          <div className="kicker" style={{ padding: '10px 10px 8px' }}>
            MENU
          </div>
          
          {NAV_ITEMS.map(item => {
            const isActive = activeTab === item.id;
            return (
              <button 
                key={item.id} 
                onClick={() => onTabChange(item.id)}
                className={`nav-item${isActive ? ' active' : ''}`}
              >
                <Icon name={item.icon} size={17} />
                <span>{item.label}</span>
                
                {item.id === 'savings' && reclaimTotal > 0 && (
                  <span 
                    className="mono" 
                    style={{ 
                      marginLeft: 'auto', 
                      fontSize: 10, 
                      padding: '2px 6px', 
                      borderRadius: 5,
                      background: 'rgba(67,255,166,0.14)', 
                      color: 'var(--lime)', 
                      border: '1px solid rgba(67,255,166,0.3)' 
                    }}
                  >
                    ${Math.round(reclaimTotal).toLocaleString()}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Privacy footer */}
        <div style={{ padding: '14px 16px', borderTop: '1px solid var(--line)' }}>
          <div className="panel-inset" style={{ padding: '12px 13px' }}>
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 8, 
              marginBottom: 7 
            }}>
              <Icon name="lock" size={13} style={{ color: 'var(--lime)' }} />
              <span 
                className="mono" 
                style={{ 
                  fontSize: 10.5, 
                  color: 'var(--lime)', 
                  letterSpacing: '0.08em' 
                }}
              >
                LOCAL VAULT
              </span>
            </div>
            <div style={{ 
              fontSize: 11, 
              color: 'var(--text-faint)', 
              lineHeight: 1.5 
            }}>
              Data never leaves this device. Clear anytime.
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="main-col">
        {/* Top bar */}
        <header className="topbar">
          <div className="mobile-brand">
            <Brandmark size="sm" />
          </div>
          
          <div className="searchbox">
            <Icon name="search" size={15} style={{ color: 'var(--text-faint)' }} />
            <input placeholder="Search transactions, vendors, categories…" />
            <span className="mono kbd">⌘K</span>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div className="topbar-meta">
              <span 
                style={{ 
                  width: 6, 
                  height: 6, 
                  borderRadius: '50%', 
                  background: 'var(--lime)', 
                  boxShadow: '0 0 6px var(--lime)' 
                }} 
                className="cursor-blink" 
              />
              <Clock />
            </div>
            
            <button 
              className="btn btn-ghost icon-btn" 
              title="Notifications"
            >
              <Icon name="bell" size={17} />
            </button>
            
            <button 
              className="btn icon-btn" 
              onClick={onUpload} 
              title="New import"
            >
              <Icon name="upload" size={16} />
            </button>
          </div>
        </header>

        {/* Content */}
        <div className="content">
          {children}
        </div>
      </main>

      {/* MOBILE BOTTOM NAV */}
      <nav className="bottom-nav">
        {NAV_ITEMS.map(item => (
          <button 
            key={item.id} 
            onClick={() => onTabChange(item.id)}
            className={`bn-item${activeTab === item.id ? ' active' : ''}`}
          >
            <Icon name={item.icon} size={20} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}