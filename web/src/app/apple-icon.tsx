import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

const WAVE =
  "M8 23.2C10.6 23.2 11.9 22.7 13.6 20.7C15.9 18 17.3 11.6 20.4 11.6C23.4 11.6 24 19.7 27 20.4C29.4 20.9 30.6 16.6 33.1 16.6C35.6 16.6 37 21.5 40 22.6";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(180deg, #B7D5F1 0%, #F4E6DA 100%)" }}>
        <svg width="132" height="132" viewBox="0 0 48 48" fill="none">
          <circle cx="24" cy="24" r="21" stroke="#1A1615" strokeWidth="2.4" />
          <path d="M7 24H41" stroke="#1A1615" strokeOpacity="0.28" strokeWidth="1.4" />
          <path d={WAVE} stroke="#1A1615" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
          <path d={WAVE} transform="matrix(1 0 0 -1 0 48)" stroke="#3A77D6" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    ),
    size,
  );
}
