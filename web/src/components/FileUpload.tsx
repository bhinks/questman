import { useState, useCallback } from 'react';
import { Icon } from './Icon';
import { Brandmark } from './Brandmark';
import { parseFile, type ParseResult } from '../utils/dataParser';
import { validateTransactions } from '../utils/dataParser';

interface FileUploadProps {
  onFileProcessed: (result: ParseResult) => void;
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
}

export function FileUpload({ onFileProcessed, isLoading, setIsLoading }: FileUploadProps) {
  const [dragActive, setDragActive] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const handleFile = async (file: File) => {
    setIsLoading(true);
    setErrors([]);
    
    try {
      const result = await parseFile(file);
      
      if (result.transactions.length > 0) {
        const validationErrors = validateTransactions(result.transactions);
        result.errors.push(...validationErrors);
      }
      
      onFileProcessed(result);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : 'Unknown error occurred']);
    } finally {
      setIsLoading(false);
    }
  };

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFile(files[0]);
    }
  }, []);

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  }, []);

  const onDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
  }, []);

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFile(e.target.files[0]);
    }
  };

  return (
    <div 
      style={{ 
        minHeight: '100vh', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        padding: '26px'
      }}
    >
      <div style={{ width: '100%', maxWidth: 680 }}>
        {/* Brand header */}
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <div style={{ 
            display: 'inline-flex', 
            marginBottom: 20 
          }}>
            <Brandmark size="md" />
          </div>
          <h1 
            style={{ 
              fontSize: 32, 
              fontWeight: 700, 
              color: 'var(--text)', 
              letterSpacing: '-0.02em',
              marginBottom: 12,
              fontFamily: 'var(--font-display)'
            }}
          >
            Finance Terminal
          </h1>
          <p style={{ 
            fontSize: 15, 
            color: 'var(--text-dim)', 
            lineHeight: 1.5 
          }}>
            Upload your financial data to begin mission analysis
          </p>
        </div>
        
        {/* Upload area */}
        <div
          className="panel hud"
          style={{
            padding: 48,
            textAlign: 'center',
            border: dragActive ? '1px solid var(--cyan)' : '1px solid var(--line)',
            background: dragActive 
              ? 'linear-gradient(180deg, rgba(28,226,255,0.06), rgba(28,226,255,0.02))' 
              : 'var(--panel)',
            cursor: isLoading ? 'not-allowed' : 'pointer',
            opacity: isLoading ? 0.6 : 1,
            transition: 'all 0.2s ease'
          }}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          onClick={() => !isLoading && document.getElementById('file-input')?.click()}
        >
          <input
            id="file-input"
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={onInputChange}
            style={{ display: 'none' }}
            disabled={isLoading}
          />
          
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
            {isLoading ? (
              <div style={{ 
                width: 48, 
                height: 48, 
                border: '2px solid var(--panel-2)',
                borderTop: '2px solid var(--cyan)',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite'
              }} />
            ) : (
              <div style={{
                width: 48,
                height: 48,
                borderRadius: 12,
                background: 'linear-gradient(135deg, var(--cyan), var(--violet))',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: dragActive ? 'var(--glow-cyan)' : '0 4px 24px rgba(28,226,255,0.2)'
              }}>
                <Icon name="upload" size={24} style={{ color: 'white' }} />
              </div>
            )}
            
            <div>
              <div style={{ 
                fontSize: 18, 
                fontWeight: 600, 
                color: 'var(--text)',
                marginBottom: 8
              }}>
                {isLoading ? 'PROCESSING DATA...' : 'DRAG FILES OR CLICK TO UPLOAD'}
              </div>
              <div style={{ 
                fontSize: 13, 
                color: 'var(--text-dim)',
                fontFamily: 'var(--font-mono)',
                letterSpacing: '0.05em'
              }}>
                SUPPORTS CSV, XLSX • MAX 50MB
              </div>
            </div>
            
            <div 
              className="panel-inset" 
              style={{ 
                padding: 16, 
                maxWidth: 420,
                textAlign: 'left'
              }}
            >
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: 8, 
                marginBottom: 12,
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
                letterSpacing: '0.08em',
                color: 'var(--text-dim)'
              }}>
                <Icon name="file" size={12} />
                <span>REQUIRED COLUMNS</span>
              </div>
              <div style={{ 
                fontSize: 13, 
                color: 'var(--text-faint)', 
                lineHeight: 1.4 
              }}>
                <div><strong style={{ color: 'var(--text-dim)' }}>Date:</strong> Transaction date (any format)</div>
                <div><strong style={{ color: 'var(--text-dim)' }}>Description:</strong> Transaction description</div>
                <div><strong style={{ color: 'var(--text-dim)' }}>Amount:</strong> Amount (+income, -expense)</div>
              </div>
            </div>
          </div>
        </div>
        
        {errors.length > 0 && (
          <div 
            className="panel"
            style={{ 
              marginTop: 24, 
              padding: 20,
              border: '1px solid var(--red)',
              background: 'rgba(255,77,109,0.05)'
            }}
          >
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 8, 
              marginBottom: 12,
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.08em',
              color: 'var(--red)'
            }}>
              <Icon name="close" size={14} style={{ color: 'var(--red)' }} />
              <span>UPLOAD ERROR</span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.4 }}>
              {errors.map((error, index) => (
                <div key={index}>• {error}</div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}