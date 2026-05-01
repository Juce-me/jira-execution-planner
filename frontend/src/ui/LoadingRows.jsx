import * as React from 'react';

export default function LoadingRows({ className = '', rowClassName = '', ariaLabel, rows = 3, columns = 2 }) {
    return (
        <div className={className} aria-label={ariaLabel}>
            {Array.from({ length: rows }, (_, item) => (
                <div key={item} className={rowClassName}>
                    {Array.from({ length: columns }, (_, column) => (
                        <span key={column} />
                    ))}
                </div>
            ))}
        </div>
    );
}
