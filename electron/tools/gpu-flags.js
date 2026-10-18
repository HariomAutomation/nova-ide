'use strict';

/**
 * Which Chromium GPU flags Nova should apply.
 *
 * On a Wayland session Chromium picks a backend that conflicts with Vulkan:
 *
 *   ERROR:wayland_surface_factory.cc:249] '--ozone-platform=wayland' is not
 *   compatible with Vulkan. Consider switching to '--ozone-platform=x11' or
 *   disabling Vulkan
 *   ERROR:vaapi_wrapper.cc:1801] vaInitialize failed: unknown libva error
 *
 * Those are noise (and a software-rendering fallback), not a Nova bug. This
 * helper is pure so the decision can be tested without launching Electron.
 *
 *   NOVA_GPU=off   -> no hardware acceleration at all (cures a blank window)
 *   NOVA_GPU=keep  -> do not touch Chromium's choices
 *   anything else  -> 'auto': pick the right ozone platform, and drop Vulkan and
 *                     VA-API on Wayland only.
 */
function gpuPlan({ platform, env = {} } = {}) {
  if (platform !== 'linux') return { mode: 'default', switches: [] };

  const forced = env.NOVA_GPU;
  if (forced === 'off') return { mode: 'off', switches: [] };
  if (forced === 'keep') return { mode: 'keep', switches: [] };

  const wayland = /wayland/i.test(env.XDG_SESSION_TYPE || '') || !!env.WAYLAND_DISPLAY;
  const switches = [['ozone-platform-hint', 'auto']];
  if (wayland) switches.push(['disable-features', 'Vulkan,VaapiVideoDecoder,VaapiVideoEncoder']);
  return { mode: 'auto', wayland, switches };
}

module.exports = { gpuPlan };
