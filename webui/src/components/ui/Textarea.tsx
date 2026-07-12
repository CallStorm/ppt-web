import { forwardRef, type TextareaHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'
import { inputClassName } from './Input'

type Props = TextareaHTMLAttributes<HTMLTextAreaElement>

export const Textarea = forwardRef<HTMLTextAreaElement, Props>(function Textarea(
  { className, ...props },
  ref,
) {
  return <textarea ref={ref} className={cn(inputClassName, 'resize-y', className)} {...props} />
})
