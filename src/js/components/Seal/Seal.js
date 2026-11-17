import React from "react"

// The maker's seal: a paper plane cut out of a block of vermilion, with the
// slightly ragged edge of a hand-pressed stamp.
export default function Seal({ size = 44 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
            <defs>
                <filter id="seal-rough" x="-10%" y="-10%" width="120%" height="120%">
                    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" result="n" />
                    <feDisplacementMap in="SourceGraphic" in2="n" scale="1.6" />
                </filter>
            </defs>
            <g filter="url(#seal-rough)">
                <rect x="3" y="3" width="42" height="42" rx="5" fill="#d8392b" />
                <path d="M11 25.5 37 12 29.5 37l-6.2-8.6Zm12.3 2.9L37 12 20.8 26.6l-.6 7.4Z" fill="#f8f2e4" fillRule="evenodd" />
            </g>
        </svg>
    )
}
