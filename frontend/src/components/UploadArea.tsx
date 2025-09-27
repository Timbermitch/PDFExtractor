import React from 'react';
import { useDropzone } from 'react-dropzone';
import { Card } from './ui/Card';

interface Props {
  onFile: (file: File) => void;
  disabled?: boolean;
}

export const UploadArea: React.FC<Props> = ({ onFile, disabled }) => {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    multiple: false,
    accept: { 'application/pdf': ['.pdf'] },
    onDrop: (files) => {
      if (files && files[0]) onFile(files[0]);
    }
  });

  return (
  <Card title="Upload PDF" className={`${disabled ? 'opacity-60 pointer-events-none' : ''}`} style={{padding:'0.6rem 0.7rem'}}>
      <div
        {...getRootProps()}
        className={`group relative`} style={{border:'2px dashed #cbd5e1', borderColor: isDragActive ? '#2563eb' : '#cbd5e1', background:isDragActive?'#e1effe':'#fff', borderRadius:'6px', padding:'1rem', textAlign:'center', cursor:'pointer', fontSize:'12px'}}
      >
        <input {...getInputProps()} disabled={disabled} />
        <p style={{margin:0, color:'#374151'}}>Drag & drop a PDF or <span style={{color:'#2563eb'}}>browse</span></p>
        <p style={{margin:'4px 0 0', color:'#64748b', fontSize:'11px'}}>PDF only</p>
      </div>
    </Card>
  );
};
