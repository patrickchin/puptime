`profile-test.jpg` is an artificial solid-forest 32×32 JPEG made for native profile-photo tests. It contains no personal photo or external artwork. SHA-256: `41a3b20216a5ac7400ef8f64eb2b0dd869ef0504c97ab27f31dd32782e40b308`.

The native test imports it into a dedicated simulator's photo library, selects it through UIKit, and verifies that the production image manipulator saves a fully decodable 512×512 JPEG. Transfer tests hash the resulting native file rather than assuming the source bytes survive crop/recompression.
