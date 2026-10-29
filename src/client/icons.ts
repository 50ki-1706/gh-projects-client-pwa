import login from "@material-symbols/svg-400/outlined/login.svg?raw";
import logout from "@material-symbols/svg-400/outlined/logout.svg?raw";
import refresh from "@material-symbols/svg-400/outlined/refresh.svg?raw";

// material's icon property accepts markup. Only these trusted, bundled assets
// enter it: never profile text, API data, or other user-provided strings.
const decorative = (svg: string) =>
  svg.replace(
    "<svg",
    '<svg aria-hidden="true" focusable="false" fill="currentColor"',
  );

export const icons = {
  login: decorative(login),
  logout: decorative(logout),
  refresh: decorative(refresh),
};
