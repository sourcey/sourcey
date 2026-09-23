import type { NormalizedSpec } from "../core/types.js";
import type { SiteNavigation } from "../core/navigation.js";
import {
  SpecContext,
  OptionsContext,
  NavigationContext,
  PageContext,
  SiteContext,
} from "../renderer/context.js";
import type { RenderOptions, CurrentPage, SiteConfig } from "../renderer/context.js";
import { Head } from "./layout/Head.js";
import { Page } from "./layout/Page.js";

export interface AppProps {
  spec: NormalizedSpec;
  options: RenderOptions;
  navigation: SiteNavigation;
  currentPage: CurrentPage;
  site: SiteConfig;
}

/**
 * Root component. Renders a complete HTML document with modern layout.
 * When embeddable, renders just the page content without html/body wrapper.
 */
export function App({ spec, options, navigation, currentPage, site }: AppProps) {
  const content = options.embeddable ? (
    <Page />
  ) : (
    <html lang="en">
      <Head />
      <body id="sourcey" data-sourcey-theme={site.theme.name}>
        <Page />
        <script src={`${options.assetBase}sourcey.js`} defer />
      </body>
    </html>
  );

  return (
    <SiteContext.Provider value={site}>
      <SpecContext.Provider value={spec}>
        <OptionsContext.Provider value={options}>
          <NavigationContext.Provider value={navigation}>
            <PageContext.Provider value={currentPage}>{content}</PageContext.Provider>
          </NavigationContext.Provider>
        </OptionsContext.Provider>
      </SpecContext.Provider>
    </SiteContext.Provider>
  );
}
