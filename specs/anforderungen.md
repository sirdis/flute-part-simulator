Ich möchte ein Simulationsprogramm für Flötenbauteile erstellen. Beim Bau irischer FLöten gehe ich folgendermaßen vor:

Ich erstelle eine yaml-Datei, in der ich die Teile der Flöte mit Löchern spezifiziere. In einer Rudall & Rose Flöte gibt es einen Linke-Hand-Teil (LH-Part), einen Rechte-Hand-Teil (RH-Part) und einen Footer. Jeder Teil hat Löcher, die mit einem Namen, einem Durchmesser und einer Position beschrieben werden. Außerdem wird die Position jedes Sockellochs für Klappensäulchen,für die Federauflage und ggf. eine Klappenführung bei langen klappen beschrieben. Ein Beispiel ist /Users/tarek/git/whistle-tools/yaml/0015-flute-holes.yaml

Mit dem Perlprogramm /Users/tarek/git/whistle-tools/src/scripts/collect-flute-holes.pl produziere ich daraus GCode für eine 4-Achsenfräse, wobei die 4. Achse das Werkstück um die Y-Achse rotiert. 

Aus historischen Gründen tut die yaml-Datei so, als wäre die Flöte entlang der x-achse ausgerichtet, aber ich vertausche die Achsen im Script.

Was ich jetzt gerne hätte, wäre ein Simulationsprogramm wie https://ncviewer.com/, das erstens in der Lage ist, die 4. Achse darzustellen und den GCode auch entsprechend rotieren zu lassen und das zweitens, aber nur optional, per Schalter, die yaml-Datei auswertet und halbtransparent die Kontur des Flötenteils dazu nimmt.

Können wir hiervon ausgehen und eine gemeinsame Spezifikation für das Simulationsprogramm erstellen? 

Die erste Frage wäre, in welcher Programmiersprache wir das machen oder ob man ggf. die quellen von ncviewer irgendwo bekommt oder von der webseite reverse-engineeren kann. Oder ob es evtl andere Projekte gibt, die man erweiter kann. Oder ob wir auf der grünen wiese beginnen. 