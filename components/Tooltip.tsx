'use client'
import { useState } from 'react'

interface Props {
  text: string
  children: React.ReactNode
}

export default function Tooltip({ text, children }: Props) {
  const [show, setShow] = useState(false)

  return (
    <span className="tooltip-anchor" style={{ position: 'relative' }}>
      {children}
      <span
        className="tooltip-icon"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onClick={() => setShow(s => !s)}
        aria-label="More info"
      >
        ?
      </span>
      {show && (
        <span style={{
          position: 'absolute',
          bottom: '100%',
          left: '50%',
          transform: 'translateX(-50%)',
          marginBottom: '6px',
          background: 'var(--text)',
          color: 'var(--bg)',
          fontSize: '12px',
          lineHeight: '1.5',
          padding: '8px 10px',
          borderRadius: '8px',
          width: '200px',
          zIndex: 50,
          whiteSpace: 'normal',
          pointerEvents: 'none',
        }}>
          {text}
        </span>
      )}
    </span>
  )
}
