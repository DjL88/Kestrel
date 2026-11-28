package app.kestrel.photo

import android.graphics.Color
import android.os.Bundle
import android.view.View
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // InFlight is dark everywhere, so the system bars always use light icons and a clock. The default follows the phone's
    // light or dark setting and drew a dark clock on InFlight's dark background (Android emulator check, 28 Nov 2026).
    enableEdgeToEdge(
      statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
      navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
    )
    super.onCreate(savedInstanceState)

    // The web view's env(safe-area-inset-*) is unreliable on Android: the bottom is 0 behind the gesture bar and the on-screen
    // keyboard, so buttons ended up under them. Leave all of that space here instead, and tell the page there is none left
    // (its safe-area rules then add nothing, so nothing is padded twice).
    val content = findViewById<View>(android.R.id.content)
    val reserved = WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime()
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val space = insets.getInsets(reserved)
      view.setPadding(space.left, space.top, space.right, space.bottom)
      WindowInsetsCompat.Builder(insets).setInsets(reserved, Insets.NONE).build()
    }
  }
}
