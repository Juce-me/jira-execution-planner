import * as React from 'react';

// `size="sm"` and `size="md"` use the shared 24px and 28px icon-control geometry.
const IconButton = React.forwardRef(function IconButton({
    as: Element = 'button',
    children,
    className = '',
    variant = '',
    size = '',
    isLoading = false,
    type = 'button',
    ...props
}, ref) {
    const classes = [variant, className, isLoading ? 'is-loading' : ''].filter(Boolean).join(' ');
    const classesWithSize = [size ? `icon-button--${size}` : '', classes].filter(Boolean).join(' ');
    const elementProps = {
        ...props,
        className: classesWithSize,
        ref,
        'data-icon-size': size || undefined,
    };

    if (Element === 'button') {
        elementProps.type = type;
    }

    return (
        <Element {...elementProps}>
            {children}
        </Element>
    );
});

export default IconButton;
