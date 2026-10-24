import React, { useState } from 'react';

interface MobileClaimViewProps {
  promoCode?: string;
  onBackToApp?: () => void;
  onRecordRedemption?: (promoCode: string) => void;
}

export const MobileClaimView: React.FC<MobileClaimViewProps> = ({
  promoCode = 'AURA-DXB-20',
  onBackToApp,
  onRecordRedemption,
}) => {
  const [isRedeemed, setIsRedeemed] = useState(false);
  const [countdown, setCountdown] = useState(34);

  const handleRedeem = () => {
    setIsRedeemed(true);
    if (onRecordRedemption) {
      onRecordRedemption(promoCode);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: '#090d16',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px',
      color: '#f8fafc',
      fontFamily: 'var(--font-sans)',
    }}>
      {/* Back button if in desktop simulator */}
      {onBackToApp && (
        <button
          onClick={onBackToApp}
          style={{
            position: 'absolute',
            top: '20px',
            left: '20px',
            background: '#1e293b',
            color: '#94a3b8',
            padding: '8px 14px',
            borderRadius: '8px',
            fontSize: '12px',
            fontWeight: 600,
          }}
        >
          ← Return to Operator Console
        </button>
      )}

      {/* Mobile Smartphone Card Container */}
      <div style={{
        width: '100%',
        maxWidth: '380px',
        background: '#121722',
        border: '1px solid #1e293b',
        borderRadius: '24px',
        padding: '28px 24px',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
        textAlign: 'center',
      }}>
        {/* Top Airport Brand */}
        <div style={{ fontSize: '11px', color: '#38bdf8', fontWeight: 800, letterSpacing: '1px', textTransform: 'uppercase' }}>
          Nova International Airport • Terminal 1
        </div>
        <h2 style={{ fontSize: '22px', fontWeight: 900, marginTop: '6px' }}>
          Duty Free Exclusive Pass
        </h2>

        {/* Campaign Visual */}
        <div style={{
          width: '100%',
          height: '180px',
          borderRadius: '16px',
          overflow: 'hidden',
          margin: '20px 0',
          border: '1px solid #334155',
        }}>
          <img
            src="https://images.unsplash.com/photo-1547887537-6158d64c35b3?w=800&q=80"
            alt="Perfume"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </div>

        {/* Offer Details */}
        <div style={{
          background: 'rgba(59, 130, 246, 0.1)',
          border: '1px solid rgba(59, 130, 246, 0.3)',
          borderRadius: '12px',
          padding: '14px',
          marginBottom: '20px',
        }}>
          <div style={{ fontSize: '13px', color: '#94a3b8' }}>Aura Élixir Oud Royale</div>
          <div style={{ fontSize: '26px', fontWeight: 900, color: '#34d399', margin: '4px 0' }}>
            20% OFF
          </div>
          <div style={{ fontSize: '11px', color: '#cbd5e1' }}>
            Flight SL882 Passenger Special • Gate 42 Boutique
          </div>
        </div>

        {/* Barcode & Promo Code Box */}
        <div style={{
          background: '#ffffff',
          borderRadius: '12px',
          padding: '16px',
          color: '#0f172a',
          marginBottom: '20px',
        }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#64748b' }}>PROMO VOUCHER CODE</div>
          <div style={{ fontSize: '22px', fontWeight: 900, letterSpacing: '2px', fontFamily: 'var(--font-mono)', margin: '4px 0' }}>
            {promoCode}
          </div>
          <div style={{ fontSize: '10px', color: '#94a3b8' }}>
            Expires in {countdown} min (At flight departure)
          </div>
        </div>

        {/* Redemption Button or Confirmation */}
        {!isRedeemed ? (
          <button
            onClick={handleRedeem}
            style={{
              width: '100%',
              background: '#10b981',
              color: '#ffffff',
              padding: '14px',
              borderRadius: '12px',
              fontSize: '15px',
              fontWeight: 800,
              boxShadow: '0 4px 15px rgba(16, 185, 129, 0.4)',
            }}
          >
            ✓ Tap To Redeem In-Store
          </button>
        ) : (
          <div style={{
            background: 'rgba(16, 185, 129, 0.15)',
            border: '1px solid #10b981',
            borderRadius: '12px',
            padding: '14px',
            color: '#34d399',
            fontWeight: 700,
            fontSize: '14px',
          }}>
            🎉 Voucher Redeemed!
            <div style={{ fontSize: '11px', color: '#cbd5e1', marginTop: '4px', fontWeight: 400 }}>
              Transaction logged to Retailer Dashboard in &lt;1 second.
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
