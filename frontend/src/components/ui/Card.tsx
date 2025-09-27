import React from 'react';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  padded?: boolean;
}

export const Card: React.FC<CardProps> = ({ title, actions, footer, children, className = '', padded = true, ...rest }) => {
  return (
    <div className={`bg-white border border-slate-200 rounded-lg shadow-sm ${className}`} {...rest}>
      {(title || actions) && (
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200">
          {title && <h3 className="text-sm font-medium text-slate-700">{title}</h3>}
          {actions && <div className="flex items-center gap-2 text-xs">{actions}</div>}
        </div>
      )}
      <div className={padded ? 'px-4 py-3' : ''}>{children}</div>
      {footer && <div className="px-4 py-2 border-t border-slate-200 text-xs text-slate-500">{footer}</div>}
    </div>
  );
};
