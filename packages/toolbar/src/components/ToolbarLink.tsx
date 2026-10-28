import { forwardRef, type ComponentPropsWithoutRef } from 'react';

/** UI-kit links in the embedded bundle use browser navigation, without a Next.js router. */
const ToolbarLink = forwardRef<HTMLAnchorElement, ComponentPropsWithoutRef<'a'>>((props, ref) => <a ref={ref} {...props} />);
ToolbarLink.displayName = 'ToolbarLink';

export default ToolbarLink;
