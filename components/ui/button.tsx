import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
export const buttonVariants = cva('btn', {
  variants: {
    variant: {
      default: 'btn-primary',
      outline: 'btn-outline',
      secondary: 'btn-dark',
      ghost: 'btn-ghost',
    },
    size: { default: '', sm: 'btn-sm', icon: 'btn-icon' },
  },
  defaultVariants: { variant: 'default', size: 'default' },
});
export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  ),
);
Button.displayName = 'Button';
