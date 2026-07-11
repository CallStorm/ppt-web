import { forwardRef, type SelectHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'
import { inputClassName } from './Input'

type Props = SelectHTMLAttributes<HTMLSelectElement>

export const selectClassName = cn(inputClassName, 'py-1.5')

export const Select = forwardRef<HTMLSelectElement, Props>(function Select(
  { className, ...props },
  ref,
) {
  return <select ref={ref} className={cn(selectClassName, className)} {...props} />
})
