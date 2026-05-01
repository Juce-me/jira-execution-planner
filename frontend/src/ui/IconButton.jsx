import * as React from 'react';

export default function IconButton({
    as: Element = 'button',
    children,
    className = '',
    variant = '',
    isLoading = false,
    type = 'button',
    ...props
}) {
    const classes = [variant, className, isLoading ? 'is-loading' : ''].filter(Boolean).join(' ');
    const elementProps = {
        ...props,
        className: classes
    };

    if (Element === 'button') {
        elementProps.type = type;
    }

    return (
        <Element {...elementProps}>
            {children}
        </Element>
    );
}
