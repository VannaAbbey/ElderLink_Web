import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../firebase';
import '../css/login.css'; // Import modal styles

/**
 * SessionValidator Component
 * 
 * Security Feature: Single-Session Enforcement
 * 
 * This component monitors the user's active session and automatically logs them out
 * if another login is detected from a different device. This prevents multiple
 * simultaneous logins for the same administrator account.
 * 
 * How it works:
 * 1. When user logs in, a unique session token is generated and stored in Firestore
 * 2. This component listens to changes in the user's session token
 * 3. If the token changes (meaning another device logged in), this session is invalidated
 * 4. User is automatically logged out with a notification
 */
export default function SessionValidator() {
  const navigate = useNavigate();
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  useEffect(() => {
    console.log('🔧 SessionValidator component mounted');
    
    // Listen to authentication state changes
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (user) {
        const userId = user.uid;
        
        console.log('🔐 SessionValidator initialized for user:', userId);
        console.log('📱 Local session token at init:', localStorage.getItem('session_token'));

        // 🔐 Listen to user document changes in real-time
        // 🚫 TEMPORARILY DISABLED FOR MULTI-USER TESTING
        // Uncomment the code below to re-enable session validation
        
        // const userDocRef = doc(db, 'users', userId);
        // const unsubscribeDoc = onSnapshot(userDocRef, (docSnapshot) => {
        //   if (docSnapshot.exists()) {
        //     const userData = docSnapshot.data();
        //     const activeSessionToken = userData.active_session_token;
            
            // ✅ Get fresh token from localStorage on each check
        //     const currentLocalToken = localStorage.getItem('session_token');

        //     console.log('🔄 Session check triggered at', new Date().toLocaleTimeString());
        //     console.log('   Local token (current):', currentLocalToken);
        //     console.log('   Active token (Firestore):', activeSessionToken);
        //     console.log('   Match:', currentLocalToken === activeSessionToken);
        //     // Check if session token matches
        //     if (currentLocalToken && activeSessionToken && currentLocalToken !== activeSessionToken) {
        //       console.warn('⚠️ SESSION MISMATCH DETECTED!');
        //       console.warn('   This device token:', currentLocalToken);
        //       console.warn('   Firestore token:', activeSessionToken);
        //       console.warn('   Another device has logged in. Forcing logout...');
              
        //       // Force logout
        //       signOut(auth).then(() => {
        //         localStorage.removeItem('session_token');
        //         localStorage.removeItem('user_id');
                
        //         // Show modal and then navigate
        //         setShowLogoutModal(true);
        //       }).catch((error) => {
        //         console.error('❌ Error during forced logout:', error);
        //       });
        //     } else if (!currentLocalToken) {
        //       console.warn('⚠️ No local session token found - possible issue');
        //     } else if (!activeSessionToken) {
        //       console.warn('⚠️ No active session token in Firestore - possible issue');
        //     } else {
        //       console.log('✅ Session valid - tokens match');
        //     }
        //   } else {
        //     console.error('❌ User document not found in Firestore');
        //   }
        // }, (error) => {
        //   console.error('❌ Session validation error:', error);
        // });
        

        console.log('⚠️ Session validation is currently DISABLED for multi-user testing');

        console.log('⚠️ Session validation is currently DISABLED for multi-user testing');

        // Cleanup listener on unmount
        // 🚫 DISABLED: Uncomment when re-enabling session validation
        
        // return () => {
        //   console.log('🛑 Cleaning up session listener for user:', userId);
        //   unsubscribeDoc();
        // };
        
      } else {
        console.log('👤 No user authenticated - SessionValidator idle');
      }
    });

    // Cleanup auth listener on unmount
    return () => {
      console.log('🔧 SessionValidator component unmounting');
      unsubscribeAuth();
    };
  }, [navigate]);

  const handleModalClose = () => {
    setShowLogoutModal(false);
    navigate('/login');
  };

  // Render logout modal if needed
  return (
    <>
      {showLogoutModal && (
        <div className="modal-overlay" onClick={handleModalClose}>
          <div className="modal-content session-logout-modal" onClick={(e) => e.stopPropagation()}>
            <h3>🔒 Session Terminated</h3>
            <p>
              Your account has been logged in from another device. 
              For security reasons, this session has been terminated.
            </p>
            <button onClick={handleModalClose}>OK</button>
          </div>
        </div>
      )}
    </>
  );
}
